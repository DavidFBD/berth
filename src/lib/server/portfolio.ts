import { erc20Abi, formatUnits, type Address } from "viem";
import { HOME_CHAIN } from "@/lib/account";
import type { OrderFacts } from "@/lib/benchmark";
import { sdkAddress } from "@/lib/chains";
import { TOKEN_LISTINGS } from "@/lib/listings";
import { ledgerDays, ledgerExplains, snapshotDay, valueHoldings, type Holding, type ValuedDay } from "@/lib/portfolio-days";
import type { PortfolioDay } from "@/lib/portfolio-history";
import { getSql } from "@/lib/server/db";
import { accountEvmAddresses } from "@/lib/server/identities";
import { loadListingPrices } from "@/lib/server/listing-prices";
import { readMarks } from "@/lib/server/marks";
import { loadOrderFacts } from "@/lib/server/order-marks";
import { getSodax } from "@/lib/server/pour-verify";
import { readRobinhoodHoldings, robinhoodParts, type RobinhoodHoldingsReader } from "@/lib/server/robinhood-balances";

/**
 * The portfolio's server half: whose account is where, what it holds, what
 * that was worth, and the table that remembers it (`portfolio_days`). The
 * rules for a row are in lib/portfolio-days; the drawing in
 * lib/portfolio-history.
 *
 * Only token listings (stocks, funds, cash) are counted. The old vault
 * positions are valued through previewRedeem and live at a different hub
 * wallet per source chain, so they are neither read nor drawn here.
 *
 * An account holds on two chains (plan P1b): the hub wallets on Sonic and,
 * since Robinhood Chain delivery, the native tokens in its own EVM wallets
 * on Robinhood Chain (lib/server/robinhood-balances). Every reader here
 * adds the two, as the browser does (lib/account-holdings), so the history
 * chart, the evening snapshot (and through it the weekly email and Most
 * held) and the assistant count what was delivered there.
 */

const LISTING_BY_ADDRESS = new Map(
  TOKEN_LISTINGS.map((listing) => [listing.address.toLowerCase(), listing]),
);
const LISTING_SYMBOLS = new Set(TOKEN_LISTINGS.map((listing) => listing.symbol));

/** The account: the hub wallet derived from the spoke address on the home chain (lib/account). */
export async function hubWalletFor(spokeAddress: string): Promise<string> {
  const wallet = await getSodax().hubProvider.getUserHubWalletAddress(sdkAddress(HOME_CHAIN, spokeAddress), HOME_CHAIN);
  return wallet.toLowerCase();
}

/** Listing balances at a hub wallet, in listing units, by symbol. Throws when unknown. */
export type ListingBalanceReader = (hubWallet: string) => Promise<Record<string, number>>;

/** Every token listing's balanceOf in one multicall; a failed read throws, never zero. */
export const readListingBalances: ListingBalanceReader = async (hubWallet) => {
  const results = await getSodax().hubProvider.publicClient.multicall({
    allowFailure: false,
    contracts: TOKEN_LISTINGS.map((listing) => ({
      address: listing.address,
      abi: erc20Abi,
      functionName: "balanceOf" as const,
      args: [hubWallet as Address] as const,
    })),
  });
  const balances: Record<string, number> = {};
  TOKEN_LISTINGS.forEach((listing, index) => {
    const raw = BigInt(results[index] as bigint);
    if (raw > 0n) balances[listing.symbol] = Number(formatUnits(raw, listing.decimals));
  });
  return balances;
};

/** One hub wallet's part of an account: the address it is derived from, the hub wallet, its balances. */
export type WalletBalances = { spoke: string; hubWallet: string; balances: Record<string, number> };

/** How an account read treats a Robinhood Chain read that did not answer. */
export type RobinhoodUnread = "throw" | "hub only";

/**
 * An account's listing balances summed over every linked EVM address's hub
 * wallet (lib/server/identities accountEvmAddresses) and the same
 * addresses' own wallets on Robinhood Chain, with each hub wallet's own
 * part and the Robinhood Chain part (`robinhood`, by symbol). One failed
 * hub read throws: a total missing a wallet would read low, and unknown is
 * never zero. A failed Robinhood Chain read throws too, unless the caller
 * says "hub only" (an account Berth never delivered there, see
 * runPortfolioSnapshot); then `robinhood` is null and the total is the
 * hub's.
 */
export async function readAccountBalances(
  spokes: readonly string[],
  readBalances: ListingBalanceReader = readListingBalances,
  deriveHubWallet: (spokeAddress: string) => Promise<string> = hubWalletFor,
  readRobinhood: RobinhoodHoldingsReader = readRobinhoodHoldings,
  onRobinhoodUnread: RobinhoodUnread = "throw",
): Promise<{
  total: Record<string, number>;
  byWallet: WalletBalances[];
  /** The Robinhood Chain part, by symbol; null when unread and the caller said "hub only". */
  robinhood: Record<string, number> | null;
  /** Each address's own Robinhood Chain part (lowercased address to holdings); empty when unread. */
  robinhoodByOwner: Map<string, Record<string, number>>;
}> {
  const unique = [...new Set(spokes.map((spoke) => spoke.toLowerCase()))];
  const [byWallet, robinhood] = await Promise.all([
    Promise.all(
      unique.map(async (spoke) => {
        const hubWallet = await deriveHubWallet(spoke);
        return { spoke, hubWallet, balances: await readBalances(hubWallet) };
      }),
    ),
    robinhoodParts(unique, readRobinhood).catch((error: unknown) => {
      if (onRobinhoodUnread === "throw") throw error;
      console.warn("[portfolio] Robinhood Chain unread, hub only", error instanceof Error ? error.message : error);
      return null;
    }),
  ]);
  const total = sumBalances([...byWallet.map((wallet) => wallet.balances), robinhood?.total ?? {}]);
  return { total, byWallet, robinhood: robinhood?.total ?? null, robinhoodByOwner: robinhood?.byOwner ?? new Map() };
}

/** Listing balances added up by symbol. */
export function sumBalances(parts: readonly Record<string, number>[]): Record<string, number> {
  const total: Record<string, number> = {};
  for (const part of parts) {
    for (const [symbol, quantity] of Object.entries(part)) total[symbol] = (total[symbol] ?? 0) + quantity;
  }
  return total;
}

/**
 * Whether an account (`u`) is on Robinhood Chain: any of its orders was
 * delivered to or sold from there (`orders.holding_chain`), or its latest
 * stored day held something in its own wallets there (`holdings[].robinhood`,
 * so tokens that arrived by transfer count too, rh-server m4). What decides
 * whether a read that could not reach that chain may stand on the hub alone.
 */
const ON_ROBINHOOD_SQL = `(
  exists (select 1 from orders r where r.user_id = u.id and r.holding_chain = 'robinhood')
  or exists (
    select 1 from portfolio_days p
      cross join lateral jsonb_array_elements(case when jsonb_typeof(p.holdings) = 'array' then p.holdings else '[]'::jsonb end) h
     where p.user_id = u.id
       and p.day = (select max(q.day) from portfolio_days q where q.user_id = u.id)
       and coalesce((h->>'robinhood')::numeric, 0) > 0
  )
)`;

/** ON_ROBINHOOD_SQL for one account. */
export async function hasRobinhoodOrders(userId: string): Promise<boolean> {
  const rows = (await getSql().query(`select ${ON_ROBINHOOD_SQL} as found from users u where u.id = $1`, [userId])) as {
    found: boolean;
  }[];
  return rows[0]?.found === true;
}

/** The solver's live prices, by listing symbol. Empty when the oracle is down. */
export async function liveListingPrices(): Promise<Record<string, number>> {
  const { prices } = await loadListingPrices();
  const out: Record<string, number> = {};
  for (const [address, price] of Object.entries(prices)) {
    const listing = LISTING_BY_ADDRESS.get(address);
    if (listing) out[listing.symbol] = price;
  }
  return out;
}

/** An account's listing orders, oldest first, with their benchmark prices (lib/server/order-marks). */
export async function loadListingOrders(userId: string): Promise<OrderFacts[]> {
  return (await loadOrderFacts(userId)).filter((order) => LISTING_SYMBOLS.has(order.symbol));
}

export type StoredPortfolioDay = PortfolioDay & {
  asOf: string;
  holdings: Holding[];
  source: "snapshot" | "ledger";
};

/** One account's stored days, and for an account retired into another, when it was. */
export type AccountDays = {
  rows: (StoredPortfolioDay & { createdAt: string })[];
  /** Set for an account merged into the one being read: its days count only before the merge. */
  retiredAt?: string;
  /** The account's id; needed only to follow a chain of merges. */
  id?: string;
  /**
   * The account it was merged into directly, at the time (account_merges
   * survivor_id: later merges repoint users.retired_into, never this).
   * Absent means the account being read.
   */
  parent?: string;
};

/**
 * The account's history, day by day: its own stored days and, for an
 * account that absorbed others in a merge (lib/server/account-merge),
 * theirs added in. A merge never deletes or moves a stored day, so each
 * retired account's days stay its own, and here they count for as long as
 * the survivor's day on the same date was written before the merge (after
 * it, the survivor's own snapshot or redrawn ledger day already reads every
 * wallet). A day an account has no row for carries its last row forward.
 * An account nobody merged into reads exactly its own rows.
 */
export async function loadPortfolioDays(userId: string): Promise<StoredPortfolioDay[]> {
  const { own, retired } = await loadAccountDays(userId);
  return combineAccountDays(own, retired);
}

/**
 * The rows loadPortfolioDays adds up, account by account and before they
 * are added: the account's own, and each account retired into it with when
 * and into whom. What the history backfill (lib/server/history-backfill)
 * needs to know which rows are whose.
 */
export async function loadAccountDays(userId: string): Promise<{ own: AccountDays; retired: AccountDays[] }> {
  const sql = getSql();
  // Every account retired into this one, with the one each was merged into
  // directly: a chain (C into A, then A into here) points C's retired_into
  // here, but C's days are already inside A's rows written after C joined A.
  const retired = (await sql.query(
    `select u.id, u.retired_at, m.survivor_id as parent
       from users u left join account_merges m on m.absorbed_id = u.id and m.status = 'done'
      where u.retired_into = $1`,
    [userId],
  )) as { id: string; retired_at: string | Date | null; parent: string | null }[];
  const ids = [userId, ...retired.map((row) => row.id)];
  const rows = (await sql.query(
    `select user_id, to_char(day, 'YYYY-MM-DD') as day, value_usd::float8 as value, holdings, source, as_of, created_at
       from portfolio_days
      where user_id = any($1::uuid[])
      order by day`,
    [ids],
  )) as {
    user_id: string;
    day: string;
    value: number;
    holdings: Holding[];
    source: "snapshot" | "ledger";
    as_of: string | Date;
    created_at: string | Date;
  }[];
  const byUser = new Map<string, AccountDays["rows"]>(ids.map((id) => [id, []]));
  for (const row of rows) {
    byUser.get(row.user_id)?.push({
      day: row.day,
      value: Number(row.value),
      holdings: row.holdings ?? [],
      source: row.source,
      asOf: new Date(row.as_of).toISOString(),
      createdAt: new Date(row.created_at).toISOString(),
    });
  }
  return {
    own: { id: userId, rows: byUser.get(userId) ?? [] },
    retired: retired.map((row) => ({
      id: row.id,
      parent: row.parent && ids.includes(row.parent) ? row.parent : userId,
      rows: byUser.get(row.id) ?? [],
      retiredAt: new Date(row.retired_at ?? 0).toISOString(),
    })),
  };
}

/** The pure half of loadPortfolioDays: the survivor's days with the retired accounts' added in. */
export function combineAccountDays(own: AccountDays, retired: readonly AccountDays[]): StoredPortfolioDay[] {
  const strip = ({ day, value, holdings, source, asOf }: StoredPortfolioDay): StoredPortfolioDay => ({ day, value, holdings, source, asOf });
  const withRows = retired.filter((account) => account.rows.length > 0);
  if (withRows.length === 0) return own.rows.map(strip);
  const byId = new Map<string, AccountDays>(retired.filter((account) => account.id).map((account) => [account.id!, account]));
  const lastOnOrBefore = (rows: AccountDays["rows"], day: string) => {
    let found: AccountDays["rows"][number] | undefined;
    for (const row of rows) {
      if (row.day > day) break;
      found = row;
    }
    return found;
  };
  const days = [...new Set([own, ...withRows].flatMap((account) => account.rows.map((row) => row.day)))].sort();
  const out: StoredPortfolioDay[] = [];
  /**
   * Whether an account's value on `day` is already inside another row:
   * the account it was merged into directly has a row for the day written
   * after that merge, or that account is itself covered, up the chain.
   */
  const covered = (account: AccountDays, day: string, seen = 0): boolean => {
    const parent = account.parent && account.parent !== own.id ? byId.get(account.parent) : undefined;
    const into = parent ?? own;
    const row = lastOnOrBefore(into.rows, day);
    if (row && account.retiredAt && Date.parse(row.createdAt) >= Date.parse(account.retiredAt)) return true;
    return !!parent && seen < 8 && covered(parent, day, seen + 1);
  };
  for (const day of days) {
    const mine = lastOnOrBefore(own.rows, day);
    const parts = mine ? [mine] : [];
    for (const account of withRows) {
      if (covered(account, day)) continue;
      const theirs = lastOnOrBefore(account.rows, day);
      if (theirs) parts.push(theirs);
    }
    if (parts.length === 0) continue;
    const holdings = new Map<string, Holding>();
    for (const part of parts) {
      for (const holding of part.holdings) {
        const known = holdings.get(holding.symbol);
        holdings.set(
          holding.symbol,
          known
            ? {
                ...known,
                quantity: known.quantity + holding.quantity,
                ...((known.robinhood ?? 0) + (holding.robinhood ?? 0) > 0 && { robinhood: (known.robinhood ?? 0) + (holding.robinhood ?? 0) }),
              }
            : { ...holding },
        );
      }
    }
    // A snapshot only when every part is a snapshot taken that very day;
    // a carried or ledger part makes the sum a derived day.
    const snapshot = parts.every((part) => part.source === "snapshot" && part.day === day);
    out.push({
      day,
      value: parts.reduce((sum, part) => sum + part.value, 0),
      holdings: [...holdings.values()],
      source: snapshot ? "snapshot" : "ledger",
      asOf: parts.map((part) => part.asOf).sort().at(-1)!,
    });
  }
  return out;
}

/**
 * Write one day. A snapshot replaces whatever was there, since it read the
 * chain; a ledger row never replaces a snapshot. `created_at` is when the
 * row was last written, which is what tells a merged account's history
 * (loadPortfolioDays) that the row already reads every wallet.
 */
export async function savePortfolioDay(
  userId: string,
  day: string,
  valued: ValuedDay,
  source: "snapshot" | "ledger",
  asOf: string,
): Promise<boolean> {
  const rows = (await getSql().query(
    `insert into portfolio_days (user_id, day, value_usd, holdings, source, as_of)
     values ($1, $2::date, $3, $4::jsonb, $5, $6::timestamptz)
     on conflict (user_id, day) do update set
       value_usd = excluded.value_usd,
       holdings = excluded.holdings,
       source = excluded.source,
       as_of = excluded.as_of,
       created_at = now()
     where excluded.source = 'snapshot' or portfolio_days.source = 'ledger'
     returning day`,
    [userId, day, valued.value, JSON.stringify(valued.holdings), source, asOf],
  )) as unknown[];
  return rows.length > 0;
}

/**
 * Accounts worth a snapshot: an EVM spoke address (the ones that have a
 * hub wallet) and at least one order or an earlier row. An account that
 * never ordered holds no listing it bought here, and reading every signup
 * each evening would outgrow the run. Oldest accounts first, so the newest
 * are the ones a run cut short would miss.
 */
export async function snapshotAccounts(): Promise<SnapshotAccount[]> {
  const rows = (await getSql().query(
    `select u.id, u.wallet_address,
            ${ON_ROBINHOOD_SQL} as robinhood_orders
       from users u
      where u.wallet_address ~ '^0x[0-9a-f]{40}$'
        and (exists (select 1 from orders o where o.user_id = u.id)
             or exists (select 1 from portfolio_days p where p.user_id = u.id))
      order by u.created_at`,
  )) as { id: string; wallet_address: string; robinhood_orders: boolean }[];
  // Every linked EVM address has its own hub wallet, and the day's value is
  // all of them together.
  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      wallet: row.wallet_address,
      wallets: (await accountEvmAddresses(row.id, row.wallet_address)).all,
      robinhoodOrders: row.robinhood_orders === true,
    })),
  );
}

/**
 * An account the snapshot reads: its home address, every linked EVM
 * address (home included), and whether any of its orders was delivered to
 * Robinhood Chain (`orders.holding_chain`).
 */
export type SnapshotAccount = { id: string; wallet: string; wallets?: string[]; robinhoodOrders?: boolean };

/**
 * Run `task` over `items`, at most `limit` at once, starting none after
 * `deadline` (epoch ms). Returns how many were never started.
 */
export async function inPool<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>,
  deadline = Infinity,
): Promise<number> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length && Date.now() < deadline) {
      const item = items[next];
      next += 1;
      await task(item);
    }
  });
  await Promise.all(workers);
  return items.length - next;
}

export type SnapshotSummary = {
  day: string | null;
  skipped?: "not within a market day's snapshot hours";
  accounts: number;
  written: number;
  /** Nothing held and no earlier row: nothing to remember. */
  empty: number;
  /**
   * Holdings valued at the oracle because the day's close was missing or
   * stood more than MARK_ORACLE_DRIFT from the oracle's price.
   */
  oraclePriced: number;
  /** Includes accounts whose read passed ACCOUNT_TIMEOUT_MS. */
  failed: number;
  /** Accounts not started before the run's deadline; tomorrow's run reads them. */
  unreached: number;
};

/** Accounts read at once; each is a derivation and one multicall. */
export const SNAPSHOT_CONCURRENCY = 4;

/** How long one account's read may take before it counts as failed and the run moves on. */
export const ACCOUNT_TIMEOUT_MS = 8_000;

/**
 * How far a stored close may stand from the solver oracle's live price
 * before the snapshot trusts the oracle instead. The newest close has had
 * no day after it to be despiked against (lib/marks settleMarks), and a
 * row once written is kept; a bad print (101 read as 500) must not be.
 */
export const MARK_ORACLE_DRIFT = 0.05;

/**
 * The price a snapshot values a holding at: the day's close, unless it is
 * missing or stands more than MARK_ORACLE_DRIFT from the oracle's price,
 * then the oracle's. With no oracle price the close stands alone.
 */
export function snapshotPrice(
  close: number | undefined,
  oracle: number | undefined,
): { price: number; source: "mark" | "oracle" } | undefined {
  const liveOk = oracle !== undefined && oracle > 0;
  if (close === undefined || !(close > 0)) return liveOk ? { price: oracle, source: "oracle" } : undefined;
  if (liveOk && Math.abs(close / oracle - 1) > MARK_ORACLE_DRIFT) return { price: oracle, source: "oracle" };
  return { price: close, source: "mark" };
}

/**
 * How long one account's Robinhood Chain read may take in the snapshot
 * before it counts as unread: well under ACCOUNT_TIMEOUT_MS, so an account
 * Berth never delivered there still writes its hub day in time, and one it
 * did falls back as designed (rh-server M1).
 */
export const ROBINHOOD_ACCOUNT_BUDGET_MS = 4_000;

/**
 * The same for an account not on Robinhood Chain (no order there, nothing
 * there on its latest day): it writes its hub day whatever the answer, so
 * it waits only briefly, and a Robinhood Chain that is down never slows the
 * run to the four second budget per account (rh-delta on 910f997).
 */
export const ROBINHOOD_HUB_ONLY_BUDGET_MS = 500;

/**
 * Today's row for every account: balances read on chain, valued at today's
 * stored close, or the oracle's live price where the close is missing or
 * out of line with it (snapshotPrice). One account failing, or taking
 * longer than ACCOUNT_TIMEOUT_MS, costs that account its row and nothing
 * else.
 *
 * Robinhood Chain is asked once for every account's wallets as the run
 * starts, many wallets to a request (lib/server/robinhood-balances), never
 * waited on as a whole: each wallet's answer lands with its own request,
 * and each account's own read waits for its wallets at most
 * ROBINHOOD_ACCOUNT_BUDGET_MS, then counts as unread. An account on
 * Robinhood Chain whose read is unread writes no row (a day missing what
 * it holds there would read low and look like money moved); an account
 * Berth never delivered there keeps its hub total, so a slow public RPC
 * never costs everyone their day.
 */
export async function runPortfolioSnapshot({
  now = new Date(),
  readBalances = readListingBalances,
  deriveHubWallet = hubWalletFor,
  readRobinhood = readRobinhoodHoldings,
  robinhoodBudgetMs = ROBINHOOD_ACCOUNT_BUDGET_MS,
  robinhoodHubOnlyBudgetMs = ROBINHOOD_HUB_ONLY_BUDGET_MS,
  livePrices = liveListingPrices,
  accounts,
  accountTimeoutMs = ACCOUNT_TIMEOUT_MS,
  deadline = Infinity,
}: {
  accountTimeoutMs?: number;
  /** Epoch ms after which no further account is started. */
  deadline?: number;
  now?: Date;
  readBalances?: ListingBalanceReader;
  deriveHubWallet?: (spokeAddress: string) => Promise<string>;
  readRobinhood?: RobinhoodHoldingsReader;
  /** Each account's Robinhood Chain read, past which it is unread. */
  robinhoodBudgetMs?: number;
  /** The same for an account not on Robinhood Chain. */
  robinhoodHubOnlyBudgetMs?: number;
  livePrices?: () => Promise<Record<string, number>>;
  accounts?: SnapshotAccount[];
} = {}): Promise<SnapshotSummary> {
  const day = snapshotDay(now);
  const summary: SnapshotSummary = {
    day: day ?? null,
    accounts: 0,
    written: 0,
    empty: 0,
    oraclePriced: 0,
    failed: 0,
    unreached: 0,
  };
  if (!day) return { ...summary, skipped: "not within a market day's snapshot hours" };

  const list = accounts ?? (await snapshotAccounts());
  summary.accounts = list.length;
  if (list.length === 0) return summary;

  const symbols = TOKEN_LISTINGS.map((listing) => listing.symbol);
  const closes = await readMarks(symbols, day);
  // One oracle read for the whole run, however many accounts ask at once.
  let oracle: Promise<Record<string, number>> | undefined;
  const oraclePrices = () =>
    (oracle ??= livePrices().catch(() => ({}) as Record<string, number>));

  const withRows = new Set(
    (
      (await getSql().query(
        `select distinct user_id from portfolio_days where user_id = any($1::uuid[])`,
        [list.map((account) => account.id)],
      )) as { user_id: string }[]
    ).map((row) => row.user_id),
  );

  const walletsOf = (account: SnapshotAccount) =>
    account.wallets && account.wallets.length > 0 ? account.wallets : [account.wallet];
  // Every wallet asked at once, request by request, never awaited: the
  // live reader remembers each wallet's answer as its request lands, and
  // each account's read below takes it from there.
  const allWallets = list.flatMap(walletsOf);
  if (allWallets.length > 0) void readRobinhood(allWallets).catch(() => undefined);
  const runRobinhood = (onRobinhood: boolean): RobinhoodHoldingsReader => (owners) =>
    withinBudget(readRobinhood(owners), onRobinhood ? robinhoodBudgetMs : robinhoodHubOnlyBudgetMs);

  const snapshotOne = async (account: SnapshotAccount, expired: () => boolean) => {
    const { total: balances, robinhood } = await readAccountBalances(
      walletsOf(account),
      readBalances,
      deriveHubWallet,
      runRobinhood(account.robinhoodOrders !== false),
      account.robinhoodOrders === false ? "hub only" : "throw",
    );
    const live = Object.keys(balances).length > 0 ? await oraclePrices() : {};
    const valued = valueHoldings(balances, (symbol) => {
      const marks = closes[symbol];
      const close = marks?.dates.at(-1) === day ? marks.values.at(-1) : undefined;
      return snapshotPrice(close, live[symbol]);
    });
    // Already counted as failed: a late answer counts and writes nothing.
    if (expired()) return;
    // Keep the Robinhood Chain part beside each holding, so a later run
    // knows this account holds there (rh-server m4).
    if (valued.ok && robinhood) {
      valued.day.holdings = valued.day.holdings.map((holding) =>
        (robinhood[holding.symbol] ?? 0) > 0 ? { ...holding, robinhood: Math.min(robinhood[holding.symbol], holding.quantity) } : holding,
      );
    }
    if (!valued.ok) {
      console.warn("[portfolio] unpriced, no row", account.id, valued.unpriced.join(","));
      summary.failed += 1;
      return;
    }
    if (valued.day.value <= 0 && !withRows.has(account.id)) {
      summary.empty += 1;
      return;
    }
    await savePortfolioDay(account.id, day, valued.day, "snapshot", now.toISOString());
    summary.written += 1;
    summary.oraclePriced += valued.day.holdings.filter((holding) => holding.source === "oracle").length;
  };

  summary.unreached = await inPool(list, SNAPSHOT_CONCURRENCY, async (account) => {
    let expired = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        snapshotOne(account, () => expired),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            expired = true;
            reject(new Error(`timed out after ${accountTimeoutMs}ms`));
          }, accountTimeoutMs);
        }),
      ]);
    } catch (error) {
      console.warn("[portfolio] snapshot failed", account.id, error instanceof Error ? error.message : error);
      summary.failed += 1;
    } finally {
      clearTimeout(timer);
    }
  }, deadline);
  return summary;
}

/** A Robinhood Chain read, or nothing read (every wallet unread) once it fails or outlasts `ms`. */
async function withinBudget(
  read: Promise<Map<string, Record<string, number>>>,
  ms: number,
): Promise<Map<string, Record<string, number>>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read.catch(() => new Map<string, Record<string, number>>()),
      new Promise<Map<string, Record<string, number>>>((resolve) => {
        timer = setTimeout(() => resolve(new Map()), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export type RebuildSummary = {
  /** Merged accounts looked at this run. */
  accounts: number;
  /** Of those, the ones whose orders explain what they hold now, redrawn from the ledger. */
  rebuilt: number;
  /** The orders do not explain the holdings: history restarts from the next snapshot. */
  unexplained: number;
  /** The chain could not be read: the account is tried again tomorrow. */
  failed: number;
  written: number;
};

/** Merged accounts redrawn in one evening run; merges are rare, and each is one read. */
export const REBUILD_PER_RUN = 5;

/**
 * History after a merge (lib/server/account-merge). The merge deletes no
 * stored day: the history read adds the retired account's days to the
 * survivor's (loadPortfolioDays). It marks the survivor with
 * `portfolio_rebuild_at`, and this redraws its ledger days the way
 * `pnpm portfolio:backfill` does for anyone: from the joined orders,
 * valued at stored closes, source 'ledger', only when those orders explain
 * what every linked hub wallet holds right now, and never over a snapshot
 * (savePortfolioDay). When they do not (a transfer the orders never saw),
 * nothing is written and the summed history stands. The flag is cleared
 * either way, unless the chain read failed.
 */
export async function rebuildMergedPortfolios({
  now = new Date(),
  readBalances = readListingBalances,
  deriveHubWallet = hubWalletFor,
  readRobinhood = readRobinhoodHoldings,
  limit = REBUILD_PER_RUN,
}: {
  now?: Date;
  readBalances?: ListingBalanceReader;
  deriveHubWallet?: (spokeAddress: string) => Promise<string>;
  readRobinhood?: RobinhoodHoldingsReader;
  limit?: number;
} = {}): Promise<RebuildSummary> {
  const sql = getSql();
  const summary: RebuildSummary = { accounts: 0, rebuilt: 0, unexplained: 0, failed: 0, written: 0 };
  const due = (await sql.query(
    `select id, wallet_address, portfolio_rebuild_at from users
      where portfolio_rebuild_at is not null and retired_into is null
      order by portfolio_rebuild_at limit $1`,
    [limit],
  )) as { id: string; wallet_address: string | null; portfolio_rebuild_at: string | Date }[];
  const today = now.toISOString().slice(0, 10);
  for (const account of due) {
    summary.accounts += 1;
    const clear = () =>
      sql.query(`update users set portfolio_rebuild_at = null where id = $1 and portfolio_rebuild_at = $2::timestamptz`, [
        account.id,
        new Date(account.portfolio_rebuild_at).toISOString(),
      ]);
    const orders = await loadListingOrders(account.id);
    const wallets = (await accountEvmAddresses(account.id, account.wallet_address)).all;
    if (orders.length === 0 || wallets.length === 0) {
      await clear();
      continue;
    }
    let balances: Record<string, number>;
    try {
      balances = (await readAccountBalances(wallets, readBalances, deriveHubWallet, readRobinhood)).total;
    } catch {
      summary.failed += 1;
      continue;
    }
    if (!ledgerExplains(orders, balances)) {
      summary.unexplained += 1;
      await clear();
      continue;
    }
    const closes = await readMarks([...new Set(orders.map((order) => order.symbol))]);
    for (const row of ledgerDays({ orders, closes, through: today })) {
      if (await savePortfolioDay(account.id, row.day, row, "ledger", row.asOf)) summary.written += 1;
    }
    summary.rebuilt += 1;
    await clear();
  }
  return summary;
}
