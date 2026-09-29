import type { Marks, OrderFacts } from "@/lib/benchmark";
import { isTradingDay } from "@/lib/market-calendar";
import { addDays, markAsOf, subtractMonths, type IsoDay } from "@/lib/marks";
import { dayOfOrder, type SnapshotBase } from "@/lib/portfolio-days";

/**
 * A person's money over time, beside the same money placed in a benchmark.
 * Pure arithmetic over what lib/server/portfolio stored; nothing here reads
 * a chain, a database or a model.
 *
 * TWO LINES, BOTH IN DOLLARS.
 * - Yours: what the account was worth at each day's close (table
 *   `portfolio_days`), ending on today's live value.
 * - The benchmark: a shadow portfolio. Every buy's dollars (fee included,
 *   as paid) buy benchmark units at the benchmark's price at the order's
 *   minute (`order.benchmarkMarks`, table `order_marks`), so the shadow
 *   never earns a session the order did not live through; every sell sells
 *   the same share of the shadow units bought for that listing as the share
 *   of the listing's held quantity it sold. The shadow is valued at each
 *   day's close. So a deposit moves both lines together, and the gap
 *   between them is what the choice of what to buy has done.
 *
 * A window shows both lines as they stand, in dollars, from its first day;
 * the benchmark is not restarted at the window's start. The first day is
 * the latest of the range's start and the first day with a value.
 *
 * TWO PERCENTAGES, COMPARABLE.
 * - `changePct`: the time-weighted return of your money over the window,
 *   daily returns chained with each day's money in and out set aside:
 *     r = (value + out) / (yesterday's value + in) - 1
 *   `in` is the dollars paid for the day's buys, counted from the start of
 *   the day (so a large deposit is never read as a return); `out` is the
 *   day's sells at that day's close for the listing, counted at its end (a
 *   sell's proceeds are paid on another chain and not read). A fixed range
 *   starts from its first close; since first buy starts from nothing, so
 *   the first day's buys are its base and the move from the order to that
 *   close (fee included) counts, as in lib/benchmark compareHolding.
 * - `benchmarkPct`: the benchmark's own price change over the same days;
 *   since first buy, from its price at the first order's minute.
 *
 * A LATER START. When money moved without an order (a transfer, or a
 * trade the ledger never saw) but a stored snapshot's holdings plus the
 * orders after it explain everything since (lib/portfolio-days
 * explainedFrom), the comparison starts from that snapshot: the shadow
 * buys the benchmark with the snapshot's whole value at the benchmark's
 * close that day, each listing's share kept apart for its sells, and both
 * percentages are told from that close with only the later orders as
 * flows. That is the same time weighting as a fixed range starting there.
 * No window starts before it; `rebasedFrom` names the day on any window
 * that starts on it.
 *
 * REFUSALS. The benchmark line is null, never guessed, when the balance
 * held is not what the orders add up to and no snapshot explains it
 * ('unexplained_balance': a sell or a transfer the ledger never saw, after
 * the newest snapshot, so the shadow would be buying for money that is not
 * there); when a buy has no dollar cost, a sell has no
 * quantity, or a sell is larger than the orders say was held
 * ('unpriced_orders'); or when a buy has no benchmark price at its minute,
 * or the benchmark no closes ('no_marks'). With the first two `changePct`
 * is null as well: money came or went that no order prices, so the
 * time-weighted figure cannot be told either. `benchmarkPct` is null
 * whenever the status is not 'ok'. A day the benchmark has no close for is
 * a gap in its line, not a copy of the day before. `changePct` is also null
 * when a sell lands on a day its listing has no close. Under two days
 * there is no line and no change ('too_short').
 *
 * THE RECORD'S START. Stored days began with the evening snapshot
 * (2026-09-25), and an earlier stretch is rebuilt from the orders only
 * when they explain the first snapshot (lib/server/history-backfill). When
 * since first buy still starts after the first buy's own close,
 * `recordFrom` names the day the record starts. Both percentages still
 * measure from the first buy (its buys are the first day's base); only
 * the drawn line starts later.
 *
 * Only listings count here: callers pass the token listing orders, not the
 * old vault positions, which `portfolio_days` does not value either.
 */

export type Range = "1w" | "1m" | "3m" | "6m" | "1y" | "since" | "all";

/** Every range, in the order a control would offer them. */
export const RANGES: readonly Range[] = ["1w", "1m", "3m", "6m", "1y", "since", "all"];

const FIXED_RANGES: readonly Range[] = ["1w", "1m", "3m", "6m", "1y"];

export type PortfolioDay = {
  day: IsoDay;
  /** Dollars, at that day's close. */
  value: number;
  /**
   * When the holdings behind the value were read. A snapshot says when the
   * cron ran; a ledger day is its close (`markAsOf`), the default.
   */
  asOf?: string;
};

export type LivePoint = {
  /**
   * Today in New York, the market's calendar: between midnight UTC and the
   * New York open it is still yesterday's date, and the live value replaces
   * that day's stored close rather than adding a day.
   */
  day: IsoDay;
  /** When the live value was read. */
  asOf: string;
  /** The account's holdings at live prices, in dollars. */
  value: number;
  /** The benchmark's live price, or null to use its latest close. */
  benchmarkPrice: number | null;
  /** Live listing prices by symbol, to value a sell placed today. */
  prices?: Readonly<Record<string, number>>;
};

export type HistoryInput = {
  /** Stored days, any order. */
  days: readonly PortfolioDay[];
  /** The account's listing orders, any order. */
  orders: readonly OrderFacts[];
  /**
   * The benchmark's symbol, the key read from each order's `benchmarkMarks`.
   * Without it no buy has a price at its minute and the benchmark is
   * refused ('no_marks').
   */
  benchmarkSymbol?: string;
  /** The benchmark's stored closes, oldest first. */
  benchmarkMarks: Marks;
  /** Stored closes per listing symbol: what values a flow the order does not price. */
  listingCloses?: Readonly<Record<string, Marks>>;
  live?: LivePoint;
  /**
   * Whether the orders account for the balance held (lib/portfolio-days
   * ledgerExplains), judged by the caller against the freshest balances it
   * has. Absent means yes.
   */
  balanceExplained?: boolean;
  /**
   * With `balanceExplained` false: the snapshot from which the orders do
   * explain the balance (lib/portfolio-days explainedFrom). The comparison
   * starts there instead of being refused.
   */
  base?: SnapshotBase;
};

export type HistoryPoint = { day: IsoDay; value: number; benchmark: number | null };

export type BenchmarkStatus =
  | "ok"
  | "unexplained_balance"
  | "unpriced_orders"
  | "no_marks"
  | "too_short";

export type HistoryResult = {
  range: Range;
  days: HistoryPoint[];
  /** The window's first day, or null when it is empty. */
  since: IsoDay | null;
  /**
   * Time-weighted percent, e.g. -1.4; null when it cannot be told, and
   * always with 'unexplained_balance' and 'unpriced_orders'.
   */
  changePct: number | null;
  /** The benchmark's price change over the same window, percent; null unless the status is 'ok'. */
  benchmarkPct: number | null;
  /** Market days the window lived through after its first day. */
  tradingDays: number;
  benchmarkStatus: BenchmarkStatus;
  /**
   * The day this window starts on because money moved without an order
   * before the snapshot it is built on (A LATER START): that snapshot's
   * day, or the first valued day after it; null otherwise.
   */
  rebasedFrom: IsoDay | null;
  /**
   * Since first buy only, not rebased: the first stored day when it comes
   * after the first buy's close (lib/portfolio-days dayOfOrder), because no
   * day before it is stored (THE RECORD'S START); null when the line
   * reaches the first buy.
   */
  recordFrom: IsoDay | null;
};

/** How far a sell may exceed what the orders bought before it is refused. */
const SELL_TOLERANCE = 0.005;
/** A dollar amount this small is nothing: the guard against dividing by dust. */
const DUST_USD = 1e-9;

type SeriesPoint = { day: IsoDay; value: number; asOf: number; live: boolean };

/** Stored days plus the live point, oldest first. */
function buildSeries(input: HistoryInput): SeriesPoint[] {
  const series: SeriesPoint[] = [...input.days]
    .filter((entry) => Number.isFinite(entry.value))
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((entry) => ({
      day: entry.day,
      value: entry.value,
      asOf: Date.parse(entry.asOf ?? markAsOf(entry.day)),
      live: false,
    }));
  const live = input.live;
  if (live && Number.isFinite(live.value)) {
    const point = { day: live.day, value: live.value, asOf: Date.parse(live.asOf), live: true };
    const last = series.at(-1);
    if (!last || live.day > last.day) series.push(point);
    else if (live.day === last.day) series[series.length - 1] = point;
  }
  return series;
}

/** The index of the first point whose holdings include an order placed at `placedAt`. */
function flowIndex(series: readonly SeriesPoint[], placedAt: number): number | undefined {
  const index = series.findIndex((point) => point.asOf >= placedAt);
  return index === -1 ? undefined : index;
}

/** The close on exactly `day`. */
function closeOn(marks: Marks | undefined, day: IsoDay): number | undefined {
  if (!marks) return undefined;
  const index = marks.dates.indexOf(day);
  return index === -1 ? undefined : marks.values[index];
}

/** The latest close on or before `day`. */
function closeOnOrBefore(marks: Marks, day: IsoDay): number | undefined {
  let found: number | undefined;
  for (let index = 0; index < marks.dates.length; index += 1) {
    if (marks.dates[index] <= day) found = marks.values[index];
    else break;
  }
  return found;
}

/** Market days after `from`, up to and including `to`. */
function tradingDaysBetween(from: IsoDay, to: IsoDay): number {
  let count = 0;
  for (let day = addDays(from, 1); day <= to; day = addDays(day, 1)) {
    if (isTradingDay(day)) count += 1;
  }
  return count;
}

type Order = OrderFacts & { at: number };

function sortedOrders(orders: readonly OrderFacts[]): Order[] {
  return orders
    .map((order) => ({ ...order, at: Date.parse(order.placedAt) }))
    .filter((order) => Number.isFinite(order.at))
    .sort((a, b) => a.at - b.at);
}

/**
 * The shadow's value at every point, or why there is none. Units are kept
 * per listing so a sell can take its listing's share with it.
 */
function shadowLine(
  series: readonly SeriesPoint[],
  orders: readonly Order[],
  symbol: string | undefined,
  marks: Marks,
  livePrice: number | null,
  basis: Basis,
): { values: (number | null)[]; status: Exclude<BenchmarkStatus, "too_short"> } {
  const none = () => series.map(() => null);
  if (basis === "unexplained") return { values: none(), status: "unexplained_balance" };
  const base = basis === "orders" ? undefined : basis;
  const lastAsOf = series.at(-1)?.asOf ?? -Infinity;
  const counted = orders.filter((order) => order.at <= lastAsOf && (!base || order.at > base.at));

  // Refusals first: an unpriced order outranks a missing mark, since a
  // mark can arrive tomorrow and a missing dollar cost cannot.
  const held = new Map<string, number>();
  for (const holding of base?.holdings ?? []) {
    held.set(holding.symbol, (held.get(holding.symbol) ?? 0) + holding.quantity);
  }
  for (const order of counted) {
    if (order.direction === "buy") {
      if (order.usd === null || order.quantity === null) return { values: none(), status: "unpriced_orders" };
      held.set(order.symbol, (held.get(order.symbol) ?? 0) + order.quantity);
    } else {
      const before = held.get(order.symbol) ?? 0;
      if (order.quantity === null || before <= 0) return { values: none(), status: "unpriced_orders" };
      if (order.quantity > before * (1 + SELL_TOLERANCE)) return { values: none(), status: "unpriced_orders" };
      held.set(order.symbol, Math.max(before - order.quantity, 0));
    }
  }
  if (marks.dates.length === 0) return { values: none(), status: "no_marks" };

  const units = new Map<string, number>();
  const quantity = new Map<string, number>();
  const values: (number | null)[] = [];
  let next = 0;
  for (const [index, point] of series.entries()) {
    if (base && index < base.index) {
      values.push(null);
      continue;
    }
    if (base && index === base.index) {
      // The snapshot's whole value buys the benchmark at that day's close.
      const close = closeOn(marks, base.day);
      if (!(close && close > 0)) return { values: none(), status: "no_marks" };
      for (const holding of base.holdings) {
        units.set(holding.symbol, (units.get(holding.symbol) ?? 0) + (holding.quantity * holding.price) / close);
        quantity.set(holding.symbol, (quantity.get(holding.symbol) ?? 0) + holding.quantity);
      }
    }
    for (; next < counted.length && counted[next].at <= point.asOf; next += 1) {
      const order = counted[next];
      const heldBefore = quantity.get(order.symbol) ?? 0;
      if (order.direction === "buy") {
        const mark = symbol === undefined ? undefined : order.benchmarkMarks?.[symbol];
        if (!(mark && mark > 0)) return { values: none(), status: "no_marks" };
        units.set(order.symbol, (units.get(order.symbol) ?? 0) + (order.usd ?? 0) / mark);
        quantity.set(order.symbol, heldBefore + (order.quantity ?? 0));
      } else {
        const sold = Math.min((order.quantity ?? 0) / heldBefore, 1);
        units.set(order.symbol, (units.get(order.symbol) ?? 0) * (1 - sold));
        quantity.set(order.symbol, Math.max(heldBefore - (order.quantity ?? 0), 0));
      }
    }
    // Today's point takes the live price, or the latest close when there
    // is none; a stored day takes its own close or nothing.
    const price = point.live
      ? (livePrice ?? closeOnOrBefore(marks, point.day))
      : closeOn(marks, point.day);
    const total = [...units.values()].reduce((sum, value) => sum + value, 0);
    values.push(price === undefined ? null : total * price);
  }
  return { values, status: "ok" };
}

/**
 * What the shadow is built on: every order ('orders'), a snapshot and the
 * orders after it (A LATER START), or nothing ('unexplained').
 */
type Basis =
  | "orders"
  | "unexplained"
  | { day: IsoDay; at: number; index: number; holdings: SnapshotBase["holdings"] };

function basisOf(input: HistoryInput, series: readonly SeriesPoint[]): Basis {
  if (input.balanceExplained ?? true) return "orders";
  const base = input.base;
  if (!base) return "unexplained";
  const index = series.findIndex((point) => point.day === base.day);
  const at = Date.parse(base.asOf);
  if (index === -1 || !Number.isFinite(at)) return "unexplained";
  return { day: base.day, at, index, holdings: base.holdings };
}

/** The first day of a range, before the first-value rule is applied. */
function rangeStart(range: Range, lastDay: IsoDay, sinceDay: IsoDay | undefined): IsoDay | undefined {
  switch (range) {
    case "1w":
      return addDays(lastDay, -7);
    case "1m":
      return subtractMonths(lastDay, 1);
    case "3m":
      return subtractMonths(lastDay, 3);
    case "6m":
      return subtractMonths(lastDay, 6);
    case "1y":
      return subtractMonths(lastDay, 12);
    case "since":
      return sinceDay;
    case "all":
      return "0000-01-01";
  }
}

/** The day the first order lands in, or the first valued day when there are no orders. */
function firstBuyDay(series: readonly SeriesPoint[], orders: readonly Order[]): IsoDay | undefined {
  const first = orders[0];
  if (!first) return series.find((point) => point.value > 0)?.day;
  const index = flowIndex(series, first.at);
  return index === undefined ? undefined : series[index].day;
}

export function portfolioHistory(input: HistoryInput, range: Range): HistoryResult {
  const series = buildSeries(input);
  const orders = sortedOrders(input.orders);
  const empty: HistoryResult = {
    range,
    days: [],
    since: null,
    changePct: null,
    benchmarkPct: null,
    tradingDays: 0,
    benchmarkStatus: "too_short",
    rebasedFrom: null,
    recordFrom: null,
  };
  const last = series.at(-1);
  if (!last) return empty;

  const basis = basisOf(input, series);
  const base = typeof basis === "object" ? basis : undefined;
  const rangeFrom = rangeStart(range, last.day, firstBuyDay(series, orders));
  if (rangeFrom === undefined) return empty;
  // No window starts before the snapshot the comparison is built on.
  const start = base && base.day > rangeFrom ? base.day : rangeFrom;
  const from = series.findIndex((point) => point.day >= start && point.value > 0);
  if (from === -1) return empty;
  // The window's first day when the snapshot is what set it (a snapshot
  // worth nothing moves it to the first valued day after).
  const rebasedFrom = base && start === base.day ? series[from].day : null;

  const livePrice = input.live?.benchmarkPrice ?? null;
  const shadow = shadowLine(series, orders, input.benchmarkSymbol, input.benchmarkMarks, livePrice, basis);
  const window = series.slice(from);
  const days: HistoryPoint[] = window.map((point, index) => ({
    day: point.day,
    value: point.value,
    benchmark: shadow.values[from + index],
  }));
  const since = window[0].day;
  const tradingDays = tradingDaysBetween(since, window.at(-1)!.day);
  const firstOrder = orders[0];
  const recordFrom =
    range === "since" && !base && firstOrder && dayOfOrder(firstOrder.placedAt) < since ? since : null;
  if (window.length < 2) {
    return { ...empty, days, since, tradingDays, benchmarkStatus: "too_short", rebasedFrom, recordFrom };
  }
  const refused = shadow.status === "unexplained_balance" || shadow.status === "unpriced_orders";

  // Money in and out at each point of the window. Since first buy counts
  // the first point's own flows (its base is what came before, nothing);
  // a fixed range starts from its first close, so its first point's flows
  // are already inside that value.
  // A window built on a snapshot starts from its value, as a fixed range does.
  const fromZero = range === "since" && !base;
  const flowIn = window.map(() => 0);
  const flowOut = window.map(() => 0);
  let changeKnown = !refused;
  for (const order of orders) {
    if (!changeKnown) break;
    const index = flowIndex(series, order.at);
    if (index === undefined || index < from || (index === from && !fromZero)) continue;
    const point = series[index];
    if (order.direction === "buy") {
      if (order.usd === null) changeKnown = false;
      else flowIn[index - from] += order.usd;
      continue;
    }
    const closes = input.listingCloses?.[order.symbol];
    const price = point.live
      ? (input.live?.prices?.[order.symbol] ?? (closes && closeOnOrBefore(closes, point.day)))
      : closeOn(closes, point.day);
    if (order.quantity === null || !price) changeKnown = false;
    else flowOut[index - from] += order.quantity * price;
  }

  let growth = 1;
  for (let index = fromZero ? 0 : 1; changeKnown && index < window.length; index += 1) {
    const before = index === 0 ? (from > 0 ? series[from - 1].value : 0) : window[index - 1].value;
    const base = before + flowIn[index];
    growth *= base > DUST_USD ? (window[index].value + flowOut[index]) / base : 1;
  }

  let benchmarkPct: number | null = null;
  if (shadow.status === "ok") {
    const marks = input.benchmarkMarks;
    const lastPoint = window.at(-1)!;
    const endMark =
      (lastPoint.live ? livePrice ?? undefined : undefined) ?? closeOnOrBefore(marks, lastPoint.day);
    const startMark = fromZero
      ? input.benchmarkSymbol && orders[0]?.benchmarkMarks?.[input.benchmarkSymbol]
      : closeOnOrBefore(marks, since);
    if (startMark && endMark) benchmarkPct = (endMark / startMark - 1) * 100;
  }

  return {
    range,
    days,
    since,
    changePct: changeKnown ? (growth - 1) * 100 : null,
    benchmarkPct,
    tradingDays,
    benchmarkStatus: shadow.status,
    rebasedFrom,
    recordFrom,
  };
}

/**
 * The ranges worth offering. A fixed range (a week, a month, ...) only when
 * the data fills it, reaching back to its start, so no two buttons ever
 * draw the same line; since first buy whenever there are two days to draw;
 * all only when there was value before the first buy (a transfer in).
 */
export function availableRanges(input: HistoryInput): Range[] {
  const series = buildSeries(input);
  const last = series.at(-1);
  if (!last) return [];
  const valued = series.find((point) => point.value > 0)?.day;
  if (!valued) return [];
  // A comparison built on a snapshot has no days before it to fill a range.
  const base = basisOf(input, series);
  const firstValued = typeof base === "object" && base.day > valued ? base.day : valued;
  const since = portfolioHistory(input, "since");

  const available: Range[] = [];
  for (const range of FIXED_RANGES) {
    const start = rangeStart(range, last.day, undefined)!;
    if (firstValued <= start && portfolioHistory(input, range).days.length >= 2) available.push(range);
  }
  if (since.days.length >= 2) available.push("since");
  if (since.since && firstValued < since.since && portfolioHistory(input, "all").days.length >= 2) {
    available.push("all");
  }
  return available;
}

/**
 * Every range worth offering, computed. Since first buy is always present,
 * even when too short to draw, so a first day still has something to say.
 */
export function historyRanges(input: HistoryInput): {
  ranges: Partial<Record<Range, HistoryResult>>;
  available: Range[];
} {
  const available = availableRanges(input);
  const ranges: Partial<Record<Range, HistoryResult>> = {};
  for (const range of new Set<Range>([...available, "since"])) {
    ranges[range] = portfolioHistory(input, range);
  }
  return { ranges, available };
}
