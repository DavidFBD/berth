import type { Marks, OrderFacts } from "@/lib/benchmark";
import { markAsOf, type IsoDay } from "@/lib/marks";
import type { HistoryPoint, HistoryResult, LivePoint, Range } from "@/lib/portfolio-history";

/**
 * What happened on each day of the line: how many dollars the holdings
 * made or lost, which holding did most of it, and which orders landed.
 * Pure arithmetic over the same stored days and orders lib/portfolio-history
 * draws; it adds to that module's answer and never changes a number in it.
 *
 * A DAY'S CHANGE, BUYS AND SELLS SET ASIDE. For every holding,
 *   held through the day:  yesterday's quantity × (today's price − yesterday's)
 *   bought that day:       quantity bought × today's price − dollars paid
 * and the day's change is their sum. A sell takes nothing away and adds
 * nothing: the quantity sold was in yesterday's holdings and is valued at
 * the day's price, as lib/portfolio-history counts a sell's proceeds. So a
 * deposit is never a gain, a fee is the loss it is, and money that moved
 * without an order (a transfer) is never read as a gain or a loss either,
 * because only prices move the figure. Where the orders explain the
 * balance it is the same dollar change the time-weighted return chains:
 *   value + out − (yesterday's value + in).
 *
 * Prices are the stored day's own (each holding was valued at one), then
 * that listing's close on the day, then for today the live price. A held
 * listing with no price on either side, or a buy with no dollar cost or no
 * quantity, makes the day's change unknown (null), never guessed.
 *
 * The first point with nothing before it is the day of the first buy (or
 * the first day on record, when the record starts later): its change is
 * from what was paid, fee included, to that point's price, and it is
 * marked `fromBuy`.
 *
 * Orders land on the first point whose holdings include them, the same rule
 * the line uses (lib/portfolio-history flowIndex).
 */

export type StoryHolding = { symbol: string; quantity: number; price: number };

/** A stored day as this module reads it: when it was read, and what was held at what price. */
export type StoryDay = { day: IsoDay; asOf: string; holdings: readonly StoryHolding[] };

/** The holding that moved the day most, by dollars. */
export type DayMover = {
  symbol: string;
  /** Dollars it added (or took, negative) that day, buys and sells set aside. */
  usd: number;
  /**
   * The listing's own price change that day, percent; for a holding first
   * bought that day, its change from what was paid. Null when neither can
   * be told.
   */
  pct: number | null;
};

export type DayStory = {
  day: IsoDay;
  /** Dollars the holdings made or lost that day; null when it cannot be told. */
  change: number | null;
  /** The change over the money at work that day (yesterday's value plus the day's buys), percent. */
  changePct: number | null;
  top: DayMover | null;
  /**
   * The holding whose own price moved most that day, in percent (for one
   * first bought that day, its change from what was paid), whatever its
   * size: so a large position does not name every day. With its dollars.
   */
  mover: DayMover | null;
  /** The listings held at this point, by symbol: what a move in the news may be about. */
  held: string[];
  /** The first point, with nothing before it: the change is from what was paid. */
  fromBuy: boolean;
  /** Every holding's part of the change, dollars, by symbol. Empty when the change is unknown. */
  parts: Readonly<Record<string, number>>;
  /**
   * The money at work in each holding that day, dollars, by symbol: what
   * was held at the day before's price plus what was paid for it that day.
   * What a holding's part is a return on. Absent when the change is unknown.
   */
  atWork?: Readonly<Record<string, number>>;
  /** Dollars paid for each holding's buys that day, by symbol. Absent when the change is unknown. */
  paid?: Readonly<Record<string, number>>;
};

/** An order as the line marks it: the point it landed on. */
export type StoryOrder = {
  /** The day of the point the order landed on. */
  day: IsoDay;
  /** When it was placed, ISO. */
  at: string;
  symbol: string;
  direction: "buy" | "sell";
  /**
   * Dollars paid, fee included, for a buy; for a sell, the quantity sold at
   * the day's price (its proceeds are paid on another chain and not read).
   * Null when it cannot be priced.
   */
  usd: number | null;
};

/**
 * Each holding's part of a window's change, largest first: the dollars its
 * price moves made on the units held each day, summed over the window's
 * days (A DAY'S CHANGE). A buy or a sell mid-window adds nothing by itself;
 * only the price moves while it was held count (and, on the day of a buy,
 * the move from what was paid to that close, fee included, as the return
 * counts it, so the fee on a buy is in it). So the contributions add up to
 * the window's `changeUsd`.
 */
export type Contribution = {
  symbol: string;
  usd: number;
  /**
   * The holding's own return while held, percent, over the window's days it
   * was held: its dollars over the money put to work in it, which is what
   * was at work in it on its first day in the window (lib/portfolio-story
   * dailyStory's rule for a day's mover) plus what was paid for it on the
   * days after. So it has the dollars' sign and period, fee included. Null
   * when no money was at work in it.
   */
  pct?: number | null;
};

/** What a range adds to lib/portfolio-history's answer. */
export type RangeStory = {
  /**
   * Each holding's dollars over the window, buys and sells set aside,
   * largest first by size. Only the days whose change is known.
   */
  contributions: Contribution[];
  /** The window's dollar change, buys and sells set aside; null when any day's is unknown. */
  changeUsd: number | null;
  /** The orders that landed on the window's points, oldest first. */
  orders: StoryOrder[];
};

/** A history point with its day's story, as the history response carries it. */
export type StoryPoint = HistoryPoint & {
  change?: number | null;
  changePct?: number | null;
  top?: DayMover | null;
  mover?: DayMover | null;
  held?: string[];
  fromBuy?: boolean;
};

export type StoryResult = HistoryResult & Partial<RangeStory> & { days: StoryPoint[] };

/** A quantity this small is nothing (as lib/portfolio-days DUST_QUANTITY). */
const DUST_QUANTITY = 1e-9;
/** A dollar amount this small is nothing. */
const DUST_USD = 1e-9;

type Point = {
  day: IsoDay;
  asOf: number;
  value: number;
  live: boolean;
  held: Map<string, StoryHolding>;
};

function holdingMap(holdings: readonly StoryHolding[]): Map<string, StoryHolding> {
  const map = new Map<string, StoryHolding>();
  for (const holding of holdings) {
    if (!(holding.quantity > DUST_QUANTITY) || !Number.isFinite(holding.quantity)) continue;
    const known = map.get(holding.symbol);
    // Merged accounts carry one listing in two parts: the quantities add up.
    map.set(holding.symbol, known ? { ...known, quantity: known.quantity + holding.quantity } : { ...holding });
  }
  return map;
}

/**
 * The stored days plus the live point, oldest first, as lib/portfolio-history
 * builds its series: today's live point replaces a stored day of the same
 * date and follows an earlier one.
 */
function buildPoints(
  days: readonly (StoryDay & { value: number })[],
  live: LivePoint | undefined,
  liveHoldings: readonly StoryHolding[] | undefined,
): Point[] {
  const points: Point[] = [...days]
    .filter((entry) => Number.isFinite(entry.value))
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((entry) => ({
      day: entry.day,
      asOf: Date.parse(entry.asOf ?? markAsOf(entry.day)),
      value: entry.value,
      live: false,
      held: holdingMap(entry.holdings),
    }));
  if (live && Number.isFinite(live.value)) {
    const point: Point = {
      day: live.day,
      asOf: Date.parse(live.asOf),
      value: live.value,
      live: true,
      held: holdingMap(liveHoldings ?? []),
    };
    const last = points.at(-1);
    if (!last || live.day > last.day) points.push(point);
    else if (live.day === last.day) points[points.length - 1] = point;
  }
  return points;
}

function closeOn(marks: Marks | undefined, day: IsoDay): number | undefined {
  if (!marks) return undefined;
  const index = marks.dates.indexOf(day);
  const value = index === -1 ? undefined : marks.values[index];
  return value !== undefined && value > 0 ? value : undefined;
}

function closeOnOrBefore(marks: Marks | undefined, day: IsoDay): number | undefined {
  if (!marks) return undefined;
  let found: number | undefined;
  for (let index = 0; index < marks.dates.length; index += 1) {
    if (marks.dates[index] > day) break;
    if (marks.values[index] > 0) found = marks.values[index];
  }
  return found;
}

export type StoryInput = {
  /** Stored days with their holdings, any order. */
  days: readonly (StoryDay & { value: number })[];
  /** The account's listing orders, any order. */
  orders: readonly OrderFacts[];
  /** Stored closes per listing symbol: a price the day's holdings do not carry. */
  listingCloses?: Readonly<Record<string, Marks>>;
  live?: LivePoint;
  /** What today's live value was made of: each holding at its live price. */
  liveHoldings?: readonly StoryHolding[];
};

/** Every point's story, oldest first, and every order with the point it landed on. */
export function dailyStory(input: StoryInput): { stories: DayStory[]; orders: StoryOrder[] } {
  const points = buildPoints(input.days, input.live, input.liveHoldings);
  const sorted = input.orders
    .map((order) => ({ ...order, at: Date.parse(order.placedAt) }))
    .filter((order) => Number.isFinite(order.at))
    .sort((a, b) => a.at - b.at);

  const priceAt = (point: Point, symbol: string): number | undefined => {
    const own = point.held.get(symbol)?.price;
    if (own !== undefined && own > 0) return own;
    const closes = input.listingCloses?.[symbol];
    if (point.live) {
      const live = input.live?.prices?.[symbol];
      return live !== undefined && live > 0 ? live : closeOnOrBefore(closes, point.day);
    }
    return closeOn(closes, point.day);
  };
  /**
   * The price a sell is valued at, the line's own rule (lib/portfolio-history):
   * the listing's close that day, or today the live price, never the
   * snapshot's held price, so the strip and the line agree on a sell day.
   */
  const sellPriceAt = (point: Point, symbol: string): number | undefined => {
    const closes = input.listingCloses?.[symbol];
    if (point.live) {
      const live = input.live?.prices?.[symbol];
      return live !== undefined && live > 0 ? live : closeOnOrBefore(closes, point.day);
    }
    return closeOn(closes, point.day);
  };

  const landed: (typeof sorted)[] = points.map(() => []);
  const orders: StoryOrder[] = [];
  for (const order of sorted) {
    const index = points.findIndex((point) => point.asOf >= order.at);
    if (index === -1) continue;
    landed[index].push(order);
    // A sell is told at the price the line values its proceeds at.
    const price = order.direction === "sell" ? sellPriceAt(points[index], order.symbol) : undefined;
    orders.push({
      day: points[index].day,
      at: order.placedAt,
      symbol: order.symbol,
      direction: order.direction,
      usd:
        order.direction === "buy"
          ? order.usd
          : order.quantity !== null && price !== undefined
            ? order.quantity * price
            : null,
    });
  }

  const stories: DayStory[] = points.map((point, index) => {
    const before = index > 0 ? points[index - 1] : undefined;
    const buys = landed[index].filter((order) => order.direction === "buy");
    const sold = new Map<string, number>();
    for (const order of landed[index]) {
      if (order.direction !== "sell") continue;
      if (order.quantity === null) return { day: point.day, change: null, changePct: null, top: null, mover: null, held: [...point.held.keys()].sort(), fromBuy: !before, parts: {} };
      sold.set(order.symbol, (sold.get(order.symbol) ?? 0) + order.quantity);
    }
    const unknown: DayStory = { day: point.day, change: null, changePct: null, top: null, mover: null, held: [...point.held.keys()].sort(), fromBuy: !before, parts: {} };
    // Nothing before and nothing bought: there is no change to tell.
    if (!before && buys.length === 0) return { ...unknown, fromBuy: false };

    const parts = new Map<string, number>();
    const add = (symbol: string, usd: number) => parts.set(symbol, (parts.get(symbol) ?? 0) + usd);
    const paid = new Map<string, number>();
    // Held through the day: what stayed moves to today's price, what was
    // sold moves to the price it was sold at (the line's rule).
    for (const [symbol, holding] of before?.held ?? []) {
      if (!(holding.price > 0)) return unknown;
      const out = Math.min(sold.get(symbol) ?? 0, holding.quantity);
      const kept = holding.quantity - out;
      if (kept > DUST_QUANTITY) {
        const now = priceAt(point, symbol);
        if (now === undefined) return unknown;
        add(symbol, kept * (now - holding.price));
      }
      if (out > DUST_QUANTITY) {
        const at = sellPriceAt(point, symbol);
        if (at === undefined) return unknown;
        add(symbol, out * (at - holding.price));
      }
      sold.set(symbol, (sold.get(symbol) ?? 0) - out);
    }
    for (const order of buys) {
      if (order.usd === null || order.quantity === null) return unknown;
      const now = priceAt(point, order.symbol);
      if (now === undefined) return unknown;
      add(order.symbol, order.quantity * now - order.usd);
      paid.set(order.symbol, (paid.get(order.symbol) ?? 0) + order.usd);
    }
    // Bought and sold again the same day: the part sold goes at its sell price.
    for (const [symbol, rest] of sold) {
      if (!(rest > DUST_QUANTITY)) continue;
      const now = priceAt(point, symbol);
      const at = sellPriceAt(point, symbol);
      if (now === undefined || at === undefined) return unknown;
      add(symbol, rest * (at - now));
    }

    const change = [...parts.values()].reduce((sum, usd) => sum + usd, 0);
    const atWork = (before?.value ?? 0) + [...paid.values()].reduce((sum, usd) => sum + usd, 0);
    const movers: DayMover[] = [...parts]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([symbol, usd]) => {
        const held = before?.held.get(symbol);
        const now = priceAt(point, symbol);
        const pct =
          held && held.price > 0 && now !== undefined
            ? (now / held.price - 1) * 100
            : (paid.get(symbol) ?? 0) > DUST_USD
              ? (usd / paid.get(symbol)!) * 100
              : null;
        return { symbol, usd, pct };
      });
    let top: DayMover | null = null;
    let mover: DayMover | null = null;
    // A crumb left after a sell can move ten percent on nothing: only a
    // holding with at least 1% of the money at work and a dollar is named
    // for its percent, unless none is.
    const atWorkIn = (symbol: string) => {
      const held = before?.held.get(symbol);
      return (held ? held.quantity * held.price : 0) + (paid.get(symbol) ?? 0);
    };
    const floor = Math.max(0.01 * ((before?.value ?? 0) + [...paid.values()].reduce((sum, usd) => sum + usd, 0)), 1);
    for (const candidate of movers) {
      if (!top || Math.abs(candidate.usd) > Math.abs(top.usd)) top = candidate;
      if (candidate.pct === null || atWorkIn(candidate.symbol) < floor) continue;
      if (!mover || Math.abs(candidate.pct) > Math.abs(mover.pct!)) mover = candidate;
    }
    if (!mover && top?.pct != null) mover = top;
    return {
      day: point.day,
      change,
      changePct: atWork > DUST_USD ? (change / atWork) * 100 : null,
      top,
      mover,
      held: [...point.held.keys()].sort(),
      fromBuy: !before,
      parts: Object.fromEntries(parts),
      atWork: Object.fromEntries([...parts.keys()].map((symbol) => [symbol, atWorkIn(symbol)])),
      paid: Object.fromEntries(paid),
    };
  });
  return { stories, orders };
}

/**
 * A range's story from the daily ones: the window's days are the result's,
 * and its first day counts only when the window starts from nothing (since
 * first buy, not built on a snapshot), the rule lib/portfolio-history uses
 * for the time-weighted return.
 */
export function rangeStory(
  result: HistoryResult,
  stories: ReadonlyMap<IsoDay, DayStory>,
  orders: readonly StoryOrder[],
  fromZero: boolean,
): RangeStory {
  const sums = new Map<string, number>();
  const putIn = new Map<string, number>();
  let changeUsd: number | null = 0;
  result.days.forEach((point, index) => {
    if (index === 0 && !fromZero) return;
    const story = stories.get(point.day);
    if (!story || story.change === null) {
      changeUsd = null;
      return;
    }
    if (changeUsd !== null) changeUsd += story.change;
    for (const [symbol, usd] of Object.entries(story.parts)) {
      sums.set(symbol, (sums.get(symbol) ?? 0) + usd);
      // Money put to work: the first day's whole stake, then only new money.
      const put = putIn.has(symbol) ? (story.paid?.[symbol] ?? 0) : (story.atWork?.[symbol] ?? 0);
      putIn.set(symbol, (putIn.get(symbol) ?? 0) + put);
    }
  });
  const since = result.days[0]?.day;
  return {
    contributions: [...sums]
      .map(([symbol, usd]) => {
        const put = putIn.get(symbol) ?? 0;
        return { symbol, usd, pct: put > DUST_USD ? (usd / put) * 100 : null };
      })
      .sort((a, b) => Math.abs(b.usd) - Math.abs(a.usd) || a.symbol.localeCompare(b.symbol)),
    changeUsd: result.days.length < 2 && !fromZero ? null : changeUsd,
    orders: since === undefined ? [] : orders.filter((order) => order.day >= since),
  };
}

/**
 * lib/portfolio-history's ranges with each day's story on its points and
 * each range's contributions and orders beside them. `fromZero` is false
 * when the comparison is built on a snapshot (A LATER START there).
 */
export function withStory(
  ranges: Partial<Record<Range, HistoryResult>>,
  input: StoryInput,
  { rebased }: { rebased: boolean },
): Partial<Record<Range, StoryResult>> {
  const { stories, orders } = dailyStory(input);
  const byDay = new Map(stories.map((story) => [story.day, story]));
  const out: Partial<Record<Range, StoryResult>> = {};
  for (const [range, result] of Object.entries(ranges) as [Range, HistoryResult][]) {
    const fromZero = range === "since" && !rebased;
    out[range] = {
      ...result,
      days: result.days.map((point) => {
        const story = byDay.get(point.day);
        if (!story) return point;
        return { ...point, change: story.change, changePct: story.changePct, top: story.top, mover: story.mover, held: story.held, fromBuy: story.fromBuy };
      }),
      ...rangeStory(result, byDay, orders, fromZero),
    };
  }
  return out;
}

/**
 * The names traded in a window, for the line under its movers: each
 * listing bought, and each sold, once, in the order first traded.
 */
export function tradeSummary(orders: readonly Pick<StoryOrder, "symbol" | "direction">[]): {
  bought: string[];
  sold: string[];
} {
  const bought: string[] = [];
  const sold: string[] = [];
  for (const order of orders) {
    const list = order.direction === "buy" ? bought : sold;
    if (!list.includes(order.symbol)) list.push(order.symbol);
  }
  return { bought, sold };
}

/** Rows in a range's "What moved your portfolio" list. */
export const RANGE_MOVERS_SHOWN = 5;
/** Names per side in the line of trades under it, before "and N more". */
export const RANGE_TRADES_NAMED = 3;

/**
 * The rows of a range's movers list: the holdings whose price moves made or
 * lost at least a cent over the range, by size of the dollars, at most
 * RANGE_MOVERS_SHOWN. Empty when nothing moved, or when any day of the
 * range is unknown (`changeUsd` null): rows that leave out a day would add
 * up to nothing the card says. The list is then not drawn.
 */
export function rangeMovers(
  contributions: readonly Contribution[] | undefined,
  changeUsd: number | null | undefined,
): Contribution[] {
  if (changeUsd === null || changeUsd === undefined) return [];
  return (contributions ?? [])
    .filter((entry) => Number.isFinite(entry.usd) && Math.abs(entry.usd) >= 0.005)
    .sort((a, b) => Math.abs(b.usd) - Math.abs(a.usd) || a.symbol.localeCompare(b.symbol))
    .slice(0, RANGE_MOVERS_SHOWN);
}

/**
 * The line of trades under a range's movers: up to RANGE_TRADES_NAMED
 * symbols bought and sold, with how many more; null when nothing was
 * traded in the range. `after`, on a range based at its first close (a
 * fixed range, or one built on a snapshot), is that first day: an order
 * landing on it is inside the base, as its moves are left out of the rows,
 * so it is not named either.
 */
export function rangeTrades(
  orders: readonly Pick<StoryOrder, "symbol" | "direction" | "day">[] | undefined,
  after: IsoDay | null = null,
): { bought: string[]; moreBought: number; sold: string[]; moreSold: number } | null {
  const { bought, sold } = tradeSummary((orders ?? []).filter((order) => after === null || order.day > after));
  if (bought.length === 0 && sold.length === 0) return null;
  return {
    bought: bought.slice(0, RANGE_TRADES_NAMED),
    moreBought: Math.max(bought.length - RANGE_TRADES_NAMED, 0),
    sold: sold.slice(0, RANGE_TRADES_NAMED),
    moreSold: Math.max(sold.length - RANGE_TRADES_NAMED, 0),
  };
}

/** A large move with news, as lib/server/moves tells it, reduced to what the line shows. */
export type StoryMove = {
  /** The day of the close the move ends on. */
  day: IsoDay;
  symbol: string;
  changePct: number;
  post: { url: string; name: string; username: string };
};

/**
 * The one move with news worth showing on the line: a listing held on the
 * day its move ends on, that day on the line, the largest when several.
 */
export function pickMove(
  moves: readonly { symbol: string; changePct: number; asOf: string; post: StoryMove["post"] }[],
  days: readonly StoryPoint[],
  heldOn: (day: IsoDay, symbol: string) => boolean,
): StoryMove | null {
  const onLine = new Set(days.map((point) => point.day));
  let best: StoryMove | null = null;
  for (const move of moves) {
    const day = move.asOf.slice(0, 10);
    if (!onLine.has(day) || !heldOn(day, move.symbol)) continue;
    if (best && Math.abs(move.changePct) <= Math.abs(best.changePct)) continue;
    best = {
      day,
      symbol: move.symbol,
      changePct: move.changePct,
      post: { url: move.post.url, name: move.post.name, username: move.post.username },
    };
  }
  return best;
}
