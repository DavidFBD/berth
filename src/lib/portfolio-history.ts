import { markAt, type Marks, type OrderFacts } from "@/lib/benchmark";
import { isTradingDay } from "@/lib/market-calendar";
import { MARK_MINUTES, addDays, markAsOf, subtractMonths, type IsoDay } from "@/lib/marks";

/**
 * A person's money over time, beside the same money placed in a benchmark.
 * Pure arithmetic over what lib/server/portfolio stored; nothing here reads
 * a chain, a database or a model.
 *
 * TWO LINES, BOTH IN DOLLARS.
 * - Yours: what the account was worth at each day's close (table
 *   `portfolio_days`), ending on today's live value.
 * - The benchmark: a shadow portfolio. Every buy's dollars (fee included,
 *   as paid) buy benchmark units at the benchmark's last close before the
 *   order (`markAt`, with the stored marks' time of day); every sell sells
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
 * - `changePct`: the time-weighted return of your money over the window.
 *   Daily returns are chained from the window's first day, each day's net
 *   dollars in or out (from the orders) set aside:
 *     r = value / (yesterday's value + today's net flow) - 1
 *   The flow counts from the start of the day it lands in, which keeps a
 *   large first deposit from being read as a return. A buy flows its
 *   dollars; a sell flows its quantity at that day's close for the listing
 *   (a sell's proceeds are paid on another chain and not read).
 * - `benchmarkPct`: the benchmark's own price change over the same days.
 *
 * REFUSALS. The benchmark line is null, never guessed, when a buy in or
 * before the window has no dollar cost, a sell has no quantity, or a sell
 * is larger than the orders say was held ('unpriced_orders'); or when the
 * benchmark has no close to buy at ('no_marks'). A day the benchmark has
 * no close for is a gap in its line, not a copy of the day before.
 * `changePct` is null when money moved on a day it cannot value. Under two
 * days there is no line and no change ('too_short').
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
  /** Today, UTC. */
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
  /** The benchmark's stored closes, oldest first. */
  benchmarkMarks: Marks;
  /** Stored closes per listing symbol: what values a flow the order does not price. */
  listingCloses?: Readonly<Record<string, Marks>>;
  live?: LivePoint;
};

export type HistoryPoint = { day: IsoDay; value: number; benchmark: number | null };

export type BenchmarkStatus = "ok" | "unpriced_orders" | "no_marks" | "too_short";

export type HistoryResult = {
  range: Range;
  days: HistoryPoint[];
  /** The window's first day, or null when it is empty. */
  since: IsoDay | null;
  /** Time-weighted percent, e.g. -1.4; null when it cannot be told. */
  changePct: number | null;
  /** The benchmark's price change over the same window, percent. */
  benchmarkPct: number | null;
  /** Market days the window lived through after its first day. */
  tradingDays: number;
  benchmarkStatus: BenchmarkStatus;
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
  marks: Marks,
  livePrice: number | null,
): { values: (number | null)[]; status: "ok" | "unpriced_orders" | "no_marks" } {
  const none = () => series.map(() => null);
  const lastAsOf = series.at(-1)?.asOf ?? -Infinity;
  const counted = orders.filter((order) => order.at <= lastAsOf);

  // Refusals first: an unpriced order outranks a missing mark, since a
  // mark can arrive tomorrow and a missing dollar cost cannot.
  const held = new Map<string, number>();
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
  for (const point of series) {
    for (; next < counted.length && counted[next].at <= point.asOf; next += 1) {
      const order = counted[next];
      const heldBefore = quantity.get(order.symbol) ?? 0;
      if (order.direction === "buy") {
        const mark = markAt(marks, order.placedAt, MARK_MINUTES);
        if (!mark) return { values: none(), status: "no_marks" };
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
  };
  const last = series.at(-1);
  if (!last) return empty;

  const start = rangeStart(range, last.day, firstBuyDay(series, orders));
  if (start === undefined) return empty;
  const from = series.findIndex((point) => point.day >= start && point.value > 0);
  if (from === -1) return empty;

  const livePrice = input.live?.benchmarkPrice ?? null;
  const shadow = shadowLine(series, orders, input.benchmarkMarks, livePrice);
  const window = series.slice(from);
  const days: HistoryPoint[] = window.map((point, index) => ({
    day: point.day,
    value: point.value,
    benchmark: shadow.values[from + index],
  }));
  const since = window[0].day;
  const tradingDays = tradingDaysBetween(since, window.at(-1)!.day);
  if (window.length < 2) {
    return { ...empty, days, since, tradingDays, benchmarkStatus: "too_short" };
  }

  // Net dollars into each point of the window after its first.
  const flows = window.map(() => 0);
  let changeKnown = true;
  for (const order of orders) {
    const index = flowIndex(series, order.at);
    if (index === undefined || index <= from) continue;
    const point = series[index];
    let dollars = order.usd;
    if (dollars === null) {
      const price =
        (point.live ? input.live?.prices?.[order.symbol] : undefined) ??
        (point.live
          ? input.listingCloses?.[order.symbol] &&
            closeOnOrBefore(input.listingCloses[order.symbol], point.day)
          : closeOn(input.listingCloses?.[order.symbol], point.day));
      dollars = order.quantity !== null && price ? order.quantity * price : null;
    }
    if (dollars === null) {
      changeKnown = false;
      break;
    }
    flows[index - from] += order.direction === "buy" ? dollars : -dollars;
  }

  let growth = 1;
  for (let index = 1; changeKnown && index < window.length; index += 1) {
    const base = window[index - 1].value + flows[index];
    growth *= base > DUST_USD ? window[index].value / base : 1;
  }

  let benchmarkPct: number | null = null;
  const marks = input.benchmarkMarks;
  const startMark = closeOnOrBefore(marks, since);
  const lastPoint = window.at(-1)!;
  const endMark =
    (lastPoint.live ? livePrice ?? undefined : undefined) ?? closeOnOrBefore(marks, lastPoint.day);
  if (startMark && endMark) benchmarkPct = (endMark / startMark - 1) * 100;

  return {
    range,
    days,
    since,
    changePct: changeKnown ? (growth - 1) * 100 : null,
    benchmarkPct,
    tradingDays,
    benchmarkStatus: shadow.status,
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
  const firstValued = series.find((point) => point.value > 0)?.day;
  if (!firstValued) return [];
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
