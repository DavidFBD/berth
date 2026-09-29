import type { Marks, OrderFacts } from "@/lib/benchmark";
import { addDays, markAsOf, type IsoDay } from "@/lib/marks";
import {
  DUST_QUANTITY,
  dayOfOrder,
  ledgerDays,
  ledgerExplains,
  ledgerQuantities,
  type LedgerDay,
} from "@/lib/portfolio-days";
import { getSql } from "@/lib/server/db";
import { readMarks } from "@/lib/server/marks";
import {
  combineAccountDays,
  loadAccountDays,
  loadListingOrders,
  savePortfolioDay,
  type AccountDays,
  type StoredPortfolioDay,
} from "@/lib/server/portfolio";

/**
 * History back to the first buy. The evening snapshot began on 2026-09-25,
 * so an account that bought before then (or before its first snapshot) has
 * no stored day between its first buy and that snapshot. This fills the
 * gap from the orders: the days from the first buy's close to the day
 * before the first snapshot, rebuilt as lib/portfolio-days ledgerDays does
 * (buys less sells placed before each close, valued at stored closes),
 * source 'ledger'.
 *
 * Only when the orders explain the first snapshot: its holdings are what
 * the orders placed before it add up to (ledgerExplains, lib/benchmark's
 * tolerance). The first snapshot is the one fact read on chain, so a gap
 * whose end the orders reach exactly holds no transfer in or out that
 * could change what the rebuilt days say (unless one went in and out
 * again before it, which nothing stored can see). When they do not, money
 * moved without an order, nothing is written, and the history keeps
 * starting where it does (lib/portfolio-history 'recordFrom').
 *
 * Never over a stored row: a day the account already has a row for is
 * left alone, and savePortfolioDay never lets a ledger row replace a
 * snapshot. For a merged account (lib/server/account-merge) the orders
 * are the joined ones and the rows are written to the survivor, so the
 * history read (combineAccountDays) counts them in place of the retired
 * accounts' rows for those days; the plan is dropped whole if writing it
 * would change any day the history already reads from the first snapshot
 * on. Safe to run again: a second run finds the days written and adds
 * nothing.
 *
 * Run by `pnpm history:backfill` (dry run by default) and by the evening
 * cron for a few accounts a night (lib/server/evening).
 */

export type BackfillVerdict =
  /** No listing orders: nothing to rebuild. */
  | "no_orders"
  /** No snapshot yet to check the orders against. */
  | "no_snapshot"
  /** The stored history already starts on or before the first buy's close. */
  | "reaches_first_buy"
  /** The orders explain the first snapshot: the gap is rebuilt. */
  | "explained"
  /** The first snapshot holds what the orders do not add up to: money moved without an order. */
  | "unexplained"
  /** Writing would change a merged account's history from its first snapshot on. */
  | "merge_conflict";

export type BackfillPlan = {
  verdict: BackfillVerdict;
  /** The first buy's close (lib/portfolio-days dayOfOrder), when there are orders. */
  firstBuyDay: IsoDay | null;
  /** The first stored snapshot, when there is one. */
  firstSnapshotDay: IsoDay | null;
  /** The ledger rows to write; empty unless the verdict is 'explained'. */
  rows: LedgerDay[];
};

/** A snapshot's holdings added up by symbol. */
function quantitiesOf(day: StoredPortfolioDay): Record<string, number> {
  const out: Record<string, number> = {};
  for (const holding of day.holdings) out[holding.symbol] = (out[holding.symbol] ?? 0) + holding.quantity;
  return out;
}

/** Whether two stored days read the same: value, source and quantities. */
function sameDay(a: StoredPortfolioDay, b: StoredPortfolioDay): boolean {
  const close = (x: number, y: number) => Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y));
  if (a.source !== b.source || !close(a.value, b.value)) return false;
  const qa = quantitiesOf(a);
  const qb = quantitiesOf(b);
  return [...new Set([...Object.keys(qa), ...Object.keys(qb)])].every((symbol) => close(qa[symbol] ?? 0, qb[symbol] ?? 0));
}

/**
 * The pure half: what to write for one account, and why. `own` and
 * `retired` are the rows as stored (lib/server/portfolio loadAccountDays),
 * `orders` the account's listing orders (the joined ones after a merge),
 * `closes` the stored closes of every listing they name.
 */
export function planHistoryBackfill({
  own,
  retired = [],
  orders,
  closes,
  now = new Date(),
}: {
  own: AccountDays;
  retired?: readonly AccountDays[];
  orders: readonly OrderFacts[];
  closes: Readonly<Record<string, Marks>>;
  now?: Date;
}): BackfillPlan {
  const history = combineAccountDays(own, retired);
  const firstPlaced = orders.map((order) => order.placedAt).sort()[0];
  const firstBuyDay = firstPlaced ? dayOfOrder(firstPlaced) : null;
  const anchor = history.find((day) => day.source === "snapshot");
  const plan = (verdict: BackfillVerdict, rows: LedgerDay[] = []): BackfillPlan => ({
    verdict,
    firstBuyDay,
    firstSnapshotDay: anchor?.day ?? null,
    rows,
  });
  if (!firstBuyDay) return plan("no_orders");
  if (!anchor) return plan("no_snapshot");
  if (history[0].day <= firstBuyDay) return plan("reaches_first_buy");

  // The orders placed before the first snapshot must add up to what it held.
  const anchorAt = Date.parse(anchor.asOf);
  const before = orders.filter((order) => Date.parse(order.placedAt) <= anchorAt);
  if (!ledgerExplains(before, quantitiesOf(anchor))) return plan("unexplained");

  // Rebuilt days stop before the first snapshot any account in the history
  // took (for a merged account, a retired one's can come before the summed
  // history's first), and skip every day this account already has a row.
  const firstRaw = [own, ...retired]
    .flatMap((account) => account.rows)
    .filter((row) => row.source === "snapshot")
    .map((row) => row.day)
    .sort()[0];
  const until = firstRaw && firstRaw < anchor.day ? firstRaw : anchor.day;
  const stored = new Set(own.rows.map((row) => row.day));
  const rows = ledgerDays({ orders, closes, through: addDays(until, -1) }).filter((row) => !stored.has(row.day));

  // A sell the orders show before its buy: the ledger is wrong somewhere.
  for (const row of rows) {
    const held = ledgerQuantities(orders, Date.parse(markAsOf(row.day))) ?? {};
    if (Object.values(held).some((quantity) => quantity < -DUST_QUANTITY)) return plan("unexplained");
  }
  if (rows.length === 0) return plan("explained");

  // Written now, the rows would read as written after any merge; check that
  // the history from the first snapshot on reads exactly as it did.
  const createdAt = now.toISOString();
  const written = [
    ...own.rows,
    ...rows.map((row) => ({ day: row.day, value: row.value, holdings: row.holdings, source: "ledger" as const, asOf: row.asOf, createdAt })),
  ].sort((a, b) => a.day.localeCompare(b.day));
  const after = new Map(combineAccountDays({ ...own, rows: written }, retired).map((day) => [day.day, day]));
  for (const day of history) {
    if (day.day < until) continue;
    const next = after.get(day.day);
    if (!next || !sameDay(day, next)) return plan("merge_conflict");
  }
  return plan("explained", rows);
}

export type BackfillReport = BackfillPlan & {
  userId: string;
  /** Listing orders counted. */
  orders: number;
  /** Rows actually written; zero on a dry run. */
  written: number;
};

/** One account: plan, and with `write` save the plan's rows. */
export async function backfillAccountHistory(
  userId: string,
  { write = false, now = new Date() }: { write?: boolean; now?: Date } = {},
): Promise<BackfillReport> {
  const [{ own, retired }, orders] = await Promise.all([loadAccountDays(userId), loadListingOrders(userId)]);
  const closes = orders.length > 0 ? await readMarks([...new Set(orders.map((order) => order.symbol))]) : {};
  const plan = planHistoryBackfill({ own, retired, orders, closes, now });
  let written = 0;
  if (write) {
    // Newest first: if a write fails or the stage runs out of time, the gap
    // left is at the start, which the next run still sees and fills.
    for (const row of [...plan.rows].reverse()) {
      if (await savePortfolioDay(userId, row.day, row, "ledger", row.asOf)) written += 1;
    }
  }
  return { ...plan, userId, orders: orders.length, written };
}

/**
 * Accounts whose stored history starts after their first order: the ones
 * the backfill could reach further back for. Survivors only (a retired
 * account's days are read through its survivor), none waiting on a merge
 * rebuild (lib/server/portfolio rebuildMergedPortfolios draws those). With
 * `limit`, a different few each day (the order turns with the date), so an
 * account the orders never explain cannot hold a place every night.
 */
export async function backfillCandidates({ limit, now = new Date() }: { limit?: number; now?: Date } = {}): Promise<string[]> {
  const rows = (await getSql().query(
    `with family as (
       select u.id as account, u.id as member from users u where u.retired_into is null
       union all
       select r.retired_into, r.id from users r where r.retired_into is not null
     ),
     firsts as (
       select f.account,
              min(p.day) as first_day
         from family f join portfolio_days p on p.user_id = f.member
        group by f.account
     )
     select u.id from users u
       join firsts f on f.account = u.id
      where u.retired_into is null
        and u.portfolio_rebuild_at is null
        and (select min(coalesce(o.filled_at, o.placed_at, o.created_at))::date
               from orders o where o.user_id = u.id) < f.first_day
      order by md5(u.id::text || $1)
      limit $2`,
    [now.toISOString().slice(0, 10), limit ?? null],
  )) as { id: string }[];
  return rows.map((row) => row.id);
}

export type HistoryBackfillSummary = {
  /** Accounts looked at. */
  accounts: number;
  /** Of those, the ones whose first snapshot the orders explain. */
  explained: number;
  /** The orders do not explain the first snapshot: history keeps its start. */
  unexplained: number;
  /** Everything else: already reaching the first buy, no snapshot yet, or a merge conflict. */
  unchanged: number;
  /** Rows written (or, on a dry run, that would be). */
  days: number;
  written: number;
  /** Accounts not started before the deadline. */
  unreached: number;
};

/** Accounts the evening run looks at: each is a few reads, no chain. */
export const HISTORY_BACKFILL_PER_RUN = 10;

/**
 * The evening stage and the script's loop. `userIds` defaults to the
 * candidates (all of them without `limit`). Starts no account after
 * `deadline` (epoch ms).
 */
export async function backfillHistories({
  write = false,
  limit,
  userIds,
  now = new Date(),
  deadline = Infinity,
  onReport,
}: {
  write?: boolean;
  limit?: number;
  userIds?: readonly string[];
  now?: Date;
  deadline?: number;
  onReport?: (report: BackfillReport) => void;
} = {}): Promise<HistoryBackfillSummary> {
  const ids = userIds ?? (await backfillCandidates({ limit, now }));
  const summary: HistoryBackfillSummary = { accounts: 0, explained: 0, unexplained: 0, unchanged: 0, days: 0, written: 0, unreached: 0 };
  for (const [index, userId] of ids.entries()) {
    if (Date.now() >= deadline) {
      summary.unreached = ids.length - index;
      break;
    }
    const report = await backfillAccountHistory(userId, { write, now });
    summary.accounts += 1;
    if (report.verdict === "explained") summary.explained += 1;
    else if (report.verdict === "unexplained") summary.unexplained += 1;
    else summary.unchanged += 1;
    summary.days += report.rows.length;
    summary.written += report.written;
    onReport?.(report);
  }
  return summary;
}
