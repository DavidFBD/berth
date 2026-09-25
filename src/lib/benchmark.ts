/**
 * How a holding has done since it was bought, beside what the same dollars
 * would have done in the S&P 500 fund. Pure arithmetic, all of it; no model
 * is asked anything here.
 *
 * The comparison is "the same dollars, the same days": each buy's cost is
 * put, on paper, into the S&P 500 fund at that fund's price at the order's
 * minute (`order.benchmarkMarks`, else the last mark before the order), and both are valued now at the same live prices. That handles
 * money added over several buys without a time-weighted return, and it is
 * the question a person actually asks: would I have been better off in the
 * index. It is not a recommendation and the copy never says it is one.
 *
 * Deliberately narrow about what it will answer. It returns nothing, rather
 * than a wrong number, when any buy lacks a dollar cost (paid in a coin
 * DefiLlama could not price, lib/orders), when a sell is among the orders (proceeds are
 * not read, lib/orders), when the balance held does not match what the
 * orders bought (a transfer in or out the orders cannot see), or when the
 * fund has no mark on or before a buy.
 */

export type OrderFacts = {
  symbol: string;
  direction: "buy" | "sell";
  /** Listing units received. */
  quantity: number | null;
  /** Dollars paid, fee included; null when the pay coin could not be priced. */
  usd: number | null;
  /** ISO timestamp of the order. */
  placedAt: string;
  /**
   * Each benchmark's price at the order's minute, by benchmark symbol (table
   * `order_marks`). Absent for an order not yet priced; lib/portfolio-history
   * then refuses the benchmark ('no_marks'), compareHolding falls back to
   * the close before the order (`markAt`).
   */
  benchmarkMarks?: Readonly<Record<string, number>>;
};

export type Marks = { dates: readonly string[]; values: readonly number[] };

export type HoldingComparison = {
  /** ISO date of the first buy. */
  since: string;
  paid: number;
  worth: number;
  /** Percent, e.g. -1.4. */
  changePct: number;
  /** What the same dollars would be worth in the S&P 500 fund now. */
  benchmarkWorth: number;
  benchmarkChangePct: number;
  /** Market days the comparison spans; under about twenty it is mostly noise. */
  tradingDays: number;
};

/** How far the balance may drift from the orders before the answer is refused. */
export const QUANTITY_TOLERANCE = 0.005;

/**
 * When in the UTC day the board's marks are taken, in minutes. The board
 * reads DefiLlama live, and DefiLlama's daily points fall at the time of
 * day the request was made; the board has been read around 12:50 UTC
 * (08:50 in New York). The stored marks (lib/marks) are taken at a fixed
 * time instead and pass their own.
 */
export const BOARD_MARK_MINUTES = 12 * 60 + 50;

/**
 * The benchmark's price as of `placedAt`. A mark belongs to its day at
 * `markMinutes` UTC, so a buy before that on a given day is measured
 * against the previous day's mark, never a later one.
 */
export function markAt(
  marks: Marks,
  placedAt: string,
  markMinutes: number = BOARD_MARK_MINUTES,
): number | undefined {
  const index = markIndexAt(marks, placedAt, markMinutes);
  return index === undefined ? undefined : marks.values[index];
}

/** Which mark `markAt` would use, by position. */
export function markIndexAt(
  marks: Marks,
  placedAt: string,
  markMinutes: number = BOARD_MARK_MINUTES,
): number | undefined {
  const placed = new Date(placedAt);
  if (Number.isNaN(placed.getTime())) return undefined;
  const day = placed.toISOString().slice(0, 10);
  const afterMark = placed.getUTCHours() * 60 + placed.getUTCMinutes() >= markMinutes;
  let found: number | undefined;
  for (let index = 0; index < marks.dates.length; index += 1) {
    const date = marks.dates[index];
    if (date < day || (date === day && afterMark)) found = index;
    else break;
  }
  return found;
}

/**
 * Marks after the one a buy was measured from: the market days the holding
 * has actually lived through. A Monday buy placed before Monday's mark was
 * measured from Friday's, so Monday's session counts.
 */
export function tradingDaysSince(marks: Marks, placedAt: string): number {
  const index = markIndexAt(marks, placedAt);
  return index === undefined ? 0 : marks.dates.length - 1 - index;
}

export function compareHolding({
  orders,
  held,
  priceNow,
  benchmarkNow,
  benchmarkMarks,
  benchmarkSymbol = "SPY",
}: {
  /** This listing's orders only. */
  orders: readonly OrderFacts[];
  /** Listing units held right now. */
  held: number;
  priceNow: number | undefined;
  benchmarkNow: number | undefined;
  benchmarkMarks: Marks | undefined;
  /** Which of `order.benchmarkMarks` to buy at; the S&P 500 fund by default. */
  benchmarkSymbol?: string;
}): HoldingComparison | undefined {
  if (orders.length === 0 || !priceNow || !benchmarkNow || !benchmarkMarks) return undefined;
  if (orders.some((order) => order.direction === "sell")) return undefined;
  if (orders.some((order) => order.usd === null || order.quantity === null)) return undefined;

  const bought = orders.reduce((sum, order) => sum + (order.quantity ?? 0), 0);
  if (bought <= 0 || Math.abs(held - bought) / bought > QUANTITY_TOLERANCE) return undefined;

  let paid = 0;
  let benchmarkUnits = 0;
  for (const order of orders) {
    const mark = order.benchmarkMarks?.[benchmarkSymbol] ?? markAt(benchmarkMarks, order.placedAt);
    if (!mark) return undefined;
    paid += order.usd ?? 0;
    benchmarkUnits += (order.usd ?? 0) / mark;
  }
  if (paid <= 0) return undefined;

  const worth = held * priceNow;
  const benchmarkWorth = benchmarkUnits * benchmarkNow;
  const first = [...orders].map((order) => order.placedAt).sort()[0];
  const since = first.slice(0, 10);
  return {
    since,
    paid,
    worth,
    changePct: (worth / paid - 1) * 100,
    benchmarkWorth,
    benchmarkChangePct: (benchmarkWorth / paid - 1) * 100,
    tradingDays: tradingDaysSince(benchmarkMarks, first),
  };
}

/** Several comparisons as one: summed dollars, the earliest start. */
export function combine(comparisons: readonly HoldingComparison[]): HoldingComparison | undefined {
  if (comparisons.length === 0) return undefined;
  const paid = comparisons.reduce((sum, item) => sum + item.paid, 0);
  const worth = comparisons.reduce((sum, item) => sum + item.worth, 0);
  const benchmarkWorth = comparisons.reduce((sum, item) => sum + item.benchmarkWorth, 0);
  const earliest = [...comparisons].sort((a, b) => a.since.localeCompare(b.since))[0];
  return {
    since: earliest.since,
    paid,
    worth,
    changePct: (worth / paid - 1) * 100,
    benchmarkWorth,
    benchmarkChangePct: (benchmarkWorth / paid - 1) * 100,
    tradingDays: earliest.tradingDays,
  };
}

/** Under this many market days a comparison is shown with a plain caveat. */
export const EARLY_DAYS = 20;
