import { QUANTITY_TOLERANCE, type Marks, type OrderFacts } from "@/lib/benchmark";
import { isTradingDay } from "@/lib/market-calendar";
import { MARK_MINUTES, addDays, markAsOf, type IsoDay } from "@/lib/marks";

const MARK_OFFSET_MS = MARK_MINUTES * 60_000;

/**
 * How a row of `portfolio_days` is made: the account's value at one day's
 * close, and the holdings behind it. Pure rules; the cron and the backfill
 * (lib/server/portfolio, scripts/portfolio-backfill.mjs) do the reading.
 *
 * Two sources, never mixed within a row:
 * - 'snapshot': the balances read on chain that day, so a transfer the
 *   orders never saw is still counted. Valued at the day's stored close,
 *   or at the solver's live price when the close is missing, and each
 *   holding says which.
 * - 'ledger': past days rebuilt from the orders (buys less sells, placed
 *   before that day's close), valued at stored closes only. Written only
 *   for an account whose balance today the orders fully explain; a day a
 *   held listing has no close for is left out, never filled in.
 */

export type Holding = {
  symbol: string;
  quantity: number;
  price: number;
  /**
   * 'mark' for the day's stored close, 'oracle' for the solver's live
   * price, 'prior_mark' for the close before the day when the day's own
   * was taken out after the row was written (repriceHolding).
   */
  source: "mark" | "oracle" | "prior_mark";
  /**
   * Of `quantity`, the part in the person's own wallets on Robinhood Chain
   * (plan P1b), written by the evening snapshot. Absent means none, or a
   * day written before it was kept. What tells the snapshot an account
   * holds there even without a Berth order there (rh-server m4).
   */
  robinhood?: number;
};

export type ValuedDay = { value: number; holdings: Holding[] };

/** A balance smaller than this is nothing (18 decimals; well under a cent of anything). */
export const DUST_QUANTITY = 1e-9;

export type PriceLookup = (symbol: string) => { price: number; source: Holding["source"] } | undefined;

/**
 * Quantities priced into a day's value. Undefined, and the listings that
 * could not be priced, when any held listing has no price at all: a value
 * missing one of its parts is not a value.
 */
export function valueHoldings(
  quantities: Readonly<Record<string, number>>,
  priceFor: PriceLookup,
): { ok: true; day: ValuedDay } | { ok: false; unpriced: string[] } {
  const holdings: Holding[] = [];
  const unpriced: string[] = [];
  for (const [symbol, quantity] of Object.entries(quantities).sort(([a], [b]) => a.localeCompare(b))) {
    if (!(quantity > DUST_QUANTITY)) continue;
    const found = priceFor(symbol);
    if (!found || !(found.price > 0)) {
      unpriced.push(symbol);
      continue;
    }
    holdings.push({ symbol, quantity, price: found.price, source: found.source });
  }
  if (unpriced.length > 0) return { ok: false, unpriced };
  const value = holdings.reduce((sum, holding) => sum + holding.quantity * holding.price, 0);
  return { ok: true, day: { value, holdings } };
}

/**
 * A stored day with one listing's close put right: the day's mark changed
 * or was taken out after the row was written (lib/server/marks). Only
 * holdings that were valued at a mark are touched; an oracle price was the
 * snapshot's own judgement and stands. Undefined when nothing changes.
 */
export function repriceHolding(
  holdings: readonly Holding[],
  symbol: string,
  price: number,
  source: "mark" | "prior_mark",
): ValuedDay | undefined {
  let changed = false;
  const next = holdings.map((holding) => {
    if (holding.symbol !== symbol || holding.source === "oracle") return holding;
    if (Math.abs(holding.price - price) <= 1e-9 * price && holding.source === source) return holding;
    changed = true;
    return { ...holding, price, source };
  });
  if (!changed) return undefined;
  const value = next.reduce((sum, holding) => sum + holding.quantity * holding.price, 0);
  return { value, holdings: next };
}

/**
 * What the orders say was held at `asOf` (epoch ms): buys less sells placed
 * by then. Undefined when a counted order has no quantity.
 */
export function ledgerQuantities(
  orders: readonly OrderFacts[],
  asOf: number,
): Record<string, number> | undefined {
  const held: Record<string, number> = {};
  for (const order of orders) {
    if (Date.parse(order.placedAt) > asOf) continue;
    if (order.quantity === null) return undefined;
    const sign = order.direction === "buy" ? 1 : -1;
    held[order.symbol] = (held[order.symbol] ?? 0) + sign * order.quantity;
  }
  return held;
}

/**
 * Whether the orders account for every balance held now, listing by
 * listing, within the tolerance lib/benchmark uses. Anything held that the
 * orders never bought, or bought and no longer held, is a transfer the
 * ledger cannot see, and the past it would draw would be wrong.
 */
export function ledgerExplains(
  orders: readonly OrderFacts[],
  balances: Readonly<Record<string, number>>,
  opening: Readonly<Record<string, number>> = {},
): boolean {
  const counted = ledgerQuantities(orders, Infinity);
  if (!counted) return false;
  const ledger: Record<string, number> = { ...opening };
  for (const [symbol, quantity] of Object.entries(counted)) ledger[symbol] = (ledger[symbol] ?? 0) + quantity;
  return quantitiesMatch(ledger, balances);
}

/** Whether `held` is `expected`, listing by listing, within lib/benchmark's tolerance. */
function quantitiesMatch(
  expected: Readonly<Record<string, number>>,
  held: Readonly<Record<string, number>>,
): boolean {
  for (const symbol of new Set([...Object.keys(expected), ...Object.keys(held)])) {
    const want = expected[symbol] ?? 0;
    const have = held[symbol] ?? 0;
    if (want < -DUST_QUANTITY) return false;
    if (want <= DUST_QUANTITY) {
      if (have > DUST_QUANTITY) return false;
      continue;
    }
    if (Math.abs(have - want) / want > QUANTITY_TOLERANCE) return false;
  }
  return true;
}

export type SnapshotBase = { day: IsoDay; asOf: string; holdings: readonly Holding[] };

/**
 * When the orders do not explain what is held, the earliest snapshot from
 * which they do: its holdings plus the orders placed after it add up to
 * the next snapshot, and to `balances` (today's, or undefined when they
 * were not read). Money moved before that snapshot without an order, and
 * nothing moved after it that the orders do not show, so a comparison may
 * start from its value. Undefined when no snapshot qualifies: money moved
 * after the newest one too.
 *
 * Linear in snapshots and orders: order times are read once, the orders'
 * running totals are taken at each snapshot, and the snapshots are walked
 * newest first, each checked against the one after it (already known to
 * explain everything since) and against today. The first that fails ends
 * the walk: an older one would span the same move. A later snapshot that
 * rebuilt from the orders ('ledger') proves nothing and is stepped over.
 */
export function explainedFrom(
  days: readonly (SnapshotBase & { source: "snapshot" | "ledger" })[],
  orders: readonly OrderFacts[],
  balances: Readonly<Record<string, number>> | undefined,
): SnapshotBase | undefined {
  const snapshots = days
    .filter((day) => day.source === "snapshot")
    .map((day) => ({ day, at: Date.parse(day.asOf) }))
    .filter((entry) => Number.isFinite(entry.at))
    .sort((a, b) => a.at - b.at);
  if (snapshots.length === 0) return undefined;
  const timed = orders
    .map((order) => ({ order, at: Date.parse(order.placedAt) }))
    .sort((a, b) => a.at - b.at);

  // The orders' running totals at each snapshot, and the newest snapshot
  // taken before an order with no quantity (it and every older one span an
  // order that cannot be counted).
  const totals: Record<string, number>[] = [];
  const running: Record<string, number> = {};
  let next = 0;
  let unknownAfter = -1;
  for (const [index, { at }] of snapshots.entries()) {
    for (; next < timed.length && timed[next].at <= at; next += 1) {
      if (timed[next].order.quantity === null) unknownAfter = index - 1;
      add(running, timed[next].order);
    }
    totals.push({ ...running });
  }
  for (; next < timed.length; next += 1) {
    if (timed[next].order.quantity === null) unknownAfter = snapshots.length - 1;
    add(running, timed[next].order);
  }
  const final = running;

  const quantities = (day: SnapshotBase) => {
    const out: Record<string, number> = {};
    for (const holding of day.holdings) out[holding.symbol] = (out[holding.symbol] ?? 0) + holding.quantity;
    return out;
  };
  /** Opening holdings plus the orders between two running totals. */
  const expected = (opening: Record<string, number>, from: Record<string, number>, to: Record<string, number>) => {
    const out = { ...opening };
    for (const symbol of new Set([...Object.keys(from), ...Object.keys(to)])) {
      out[symbol] = (out[symbol] ?? 0) + (to[symbol] ?? 0) - (from[symbol] ?? 0);
    }
    return out;
  };

  let found: SnapshotBase | undefined;
  for (let index = snapshots.length - 1; index >= 0; index -= 1) {
    if (index <= unknownAfter) break;
    const { day } = snapshots[index];
    const opening = quantities(day);
    if (index + 1 < snapshots.length) {
      const later = snapshots[index + 1].day;
      if (!quantitiesMatch(expected(opening, totals[index], totals[index + 1]), quantities(later))) break;
    }
    if (balances && !quantitiesMatch(expected(opening, totals[index], final), balances)) break;
    found = { day: day.day, asOf: day.asOf, holdings: day.holdings };
  }
  return found;
}

function add(running: Record<string, number>, order: OrderFacts): void {
  if (order.quantity === null) return;
  const sign = order.direction === "buy" ? 1 : -1;
  running[order.symbol] = (running[order.symbol] ?? 0) + sign * order.quantity;
}

/** The market day whose close is the first to come after `placedAt`. */
export function dayOfOrder(placedAt: string): IsoDay {
  let day = placedAt.slice(0, 10);
  if (Date.parse(placedAt) > Date.parse(markAsOf(day))) day = addDays(day, 1);
  while (!isTradingDay(day)) day = addDays(day, 1);
  return day;
}

export type LedgerDay = { day: IsoDay; asOf: string } & ValuedDay;

/**
 * Past days rebuilt from the orders, from the first order's day through
 * `through`, market days only. Stored closes only: a day on which any held
 * listing has no close is skipped. Nothing at all when an order has no
 * quantity.
 */
export function ledgerDays({
  orders,
  closes,
  through,
}: {
  orders: readonly OrderFacts[];
  closes: Readonly<Record<string, Marks>>;
  through: IsoDay;
}): LedgerDay[] {
  if (orders.length === 0) return [];
  if (ledgerQuantities(orders, Infinity) === undefined) return [];
  const first = [...orders].map((order) => order.placedAt).sort()[0];
  const out: LedgerDay[] = [];
  for (let day = dayOfOrder(first); day <= through; day = addDays(day, 1)) {
    if (!isTradingDay(day)) continue;
    const asOf = markAsOf(day);
    const quantities = ledgerQuantities(orders, Date.parse(asOf));
    if (!quantities) return [];
    const valued = valueHoldings(quantities, (symbol) => {
      const marks = closes[symbol];
      const index = marks ? marks.dates.indexOf(day) : -1;
      return index === -1 ? undefined : { price: marks.values[index], source: "mark" };
    });
    if (valued.ok) out.push({ day, asOf, ...valued.day });
  }
  return out;
}

/** How long after a day's close its snapshot may still be taken. */
export const SNAPSHOT_WINDOW_HOURS = 6;

/**
 * The market day a snapshot taken at `now` belongs to: the latest day whose
 * close has passed, if it passed within the last few hours. Vercel may fire
 * a daily cron anywhere in its hour, so a run meant for Friday evening can
 * land after midnight UTC and must still be Friday's. Undefined outside
 * that window (a manual run at noon), when the balances read would not be
 * any day's close.
 */
export function snapshotDay(now: Date): IsoDay | undefined {
  const day = new Date(now.getTime() - MARK_OFFSET_MS).toISOString().slice(0, 10);
  if (!isTradingDay(day)) return undefined;
  const since = now.getTime() - Date.parse(markAsOf(day));
  return since >= 0 && since <= SNAPSHOT_WINDOW_HOURS * 3_600_000 ? day : undefined;
}
