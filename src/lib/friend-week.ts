import type { Marks, OrderFacts } from "@/lib/benchmark";
import { addDays, type IsoDay } from "@/lib/marks";
import { explainedFrom, ledgerExplains, type SnapshotBase } from "@/lib/portfolio-days";
import { portfolioHistory, type PortfolioDay } from "@/lib/portfolio-history";

/**
 * "Compare with friends": a friend's line beside yours on the account card,
 * percent only. Off unless both turn on "Let my friends compare their week
 * with mine" (profiles.share_week, lib/server/social/compare), and only ever
 * over the window the card already shows: 1W, or since first buy from the
 * later of the two first buys.
 *
 * What leaves the server is the friend's return so far, day by day, from
 * the window's first close: time weighted, so money in and out moves
 * nothing and no amount can be read back from it, rounded to a tenth of a
 * point. Never a value, a holding, a quantity or a price. No ranking: the
 * card draws two lines and names whose is whose.
 *
 * Pure: the arithmetic is lib/portfolio-history's own, run on the friend's
 * stored days. Their live value is never read (no chain read on anyone's
 * behalf), so their line ends on their last evening.
 */

/**
 * Where the account card keeps the friend picked (hooks/use-stored-choice),
 * by username; cleared when the account signs out or changes
 * (components/sign-out-sweep), so it never outlives the account.
 */
export const FRIEND_CHOICE_KEY = "berth.portfolio.friend";

/** The windows a friend's line is drawn over: the card's 1W and First buy. */
export type FriendWeekRange = "1w" | "since";
export const FRIEND_WEEK_RANGES: readonly FriendWeekRange[] = ["1w", "since"];

/** How far back a 1W window may start: a week plus a long weekend. */
export const FRIEND_WEEK_MAX_DAYS = 10;

/** A friend's return so far on one day, percent, rounded to a tenth. */
export type FriendWeekPoint = { day: IsoDay; pct: number };

/**
 * The friend's line over the window. `from` is the window's first close,
 * where it is 0%: the day asked for, or later when the friend's record
 * starts later (the overlap).
 */
export type FriendWeek = { from: IsoDay; days: FriendWeekPoint[] };

export type FriendWeekResponse = { week: FriendWeek | null };

/** A friend who compares, as the picker shows them: their card's face. Never XP, never an amount. */
export type CompareFriend = { handle: string; avatarId: string | null; level: number };

export type CompareFriendsResponse = { friends: CompareFriend[] };

const NO_MARKS: Marks = { dates: [], values: [] };

/** Rounded to a tenth of a point: what is drawn, and no finer. */
export function roundTenth(pct: number): number {
  const rounded = Math.round(pct * 10) / 10;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * A portfolio's return so far at each stored day, percent, from its first
 * valued close, with money in and out set aside (lib/portfolio-history
 * THE PERCENT LINE over "all"). Whether the orders explain what is held is
 * judged on the newest stored day, as the weekly summary does, and a
 * comparison built on a later snapshot starts there. Null when the return
 * cannot be told.
 */
export function returnSeries({
  days,
  orders,
  listingCloses,
}: {
  days: readonly (PortfolioDay & SnapshotBase & { source: "snapshot" | "ledger" })[];
  orders: readonly OrderFacts[];
  listingCloses: Readonly<Record<string, Marks>>;
}): FriendWeekPoint[] | null {
  const lastDay = days.at(-1);
  if (!lastDay) return null;
  const asOf = Date.parse(lastDay.asOf);
  const balanceExplained = ledgerExplains(
    orders.filter((order) => Date.parse(order.placedAt) <= asOf),
    Object.fromEntries(lastDay.holdings.map((holding) => [holding.symbol, holding.quantity])),
  );
  const base = balanceExplained ? undefined : explainedFrom(days, orders, undefined);
  const drawn = base ? days.filter((day) => day.source === "snapshot" || day.day <= base.day) : days;
  const result = portfolioHistory(
    { days: drawn, orders, benchmarkMarks: NO_MARKS, listingCloses, balanceExplained, base },
    "all",
  );
  if (result.changePct === null || result.days.length < 2) return null;
  const points: FriendWeekPoint[] = [];
  for (const point of result.days) {
    if (point.returnPct == null || !Number.isFinite(point.returnPct)) return null;
    points.push({ day: point.day, pct: point.returnPct });
  }
  return points;
}

/**
 * The series from `from`: rebased so the first close on or after it is 0%,
 * rounded to a tenth. Null under two points.
 */
export function friendWindow(series: readonly FriendWeekPoint[] | null, from: IsoDay): FriendWeek | null {
  if (!series) return null;
  const start = series.findIndex((point) => point.day >= from);
  if (start === -1) return null;
  const base = 1 + series[start].pct / 100;
  if (!(base > 0)) return null;
  const days = series.slice(start).map((point) => ({
    day: point.day,
    pct: roundTenth(((1 + point.pct / 100) / base - 1) * 100),
  }));
  if (days.length < 2) return null;
  return { from: days[0].day, days };
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whether the viewer may ask for a window starting on `from`: never in the
 * future, a 1W window within FRIEND_WEEK_MAX_DAYS of today, and since first
 * buy never before the viewer's own first valued day. So the friend's line
 * is only ever as long as the viewer's own.
 */
export function windowAllowed(
  range: unknown,
  from: unknown,
  { today, ownFirstDay }: { today: IsoDay; ownFirstDay: IsoDay | null },
): from is IsoDay {
  if (typeof from !== "string" || !ISO_DAY.test(from) || from > today) return false;
  if (range === "1w") return from >= addDays(today, -FRIEND_WEEK_MAX_DAYS);
  if (range === "since") return ownFirstDay !== null && from >= ownFirstDay;
  return false;
}

/** One point of the two lines as the card draws them, both from 0% at `anchor`. */
export type AlignedPoint = { day: IsoDay; you: number; friend: number | null };

/**
 * Your line and a friend's over the same days: both rebased to 0% at the
 * first close of the window that both lines have (the anchor), so neither
 * starts with a head start. Your later points keep your own days (today's
 * live point included); the friend's line is null where they have no
 * stored close. Null when fewer than two points remain.
 */
export function alignWithFriend(
  points: readonly { day: IsoDay; returnPct?: number | null }[],
  week: FriendWeek | null,
): { anchor: IsoDay; points: AlignedPoint[] } | null {
  if (!week) return null;
  const friend = new Map(week.days.map((point) => [point.day, point.pct]));
  const at = points.findIndex((point) => point.day >= week.from && point.returnPct != null && friend.has(point.day));
  if (at === -1) return null;
  const youBase = 1 + points[at].returnPct! / 100;
  const friendBase = 1 + friend.get(points[at].day)! / 100;
  if (!(youBase > 0) || !(friendBase > 0)) return null;
  // A line already at 0% on the anchor is kept exactly as it is.
  const rebase = (pct: number, base: number) => (base === 1 ? pct : ((1 + pct / 100) / base - 1) * 100);
  const out: AlignedPoint[] = [];
  for (const point of points.slice(at)) {
    if (point.returnPct == null) return null;
    const theirs = friend.get(point.day);
    out.push({
      day: point.day,
      you: rebase(point.returnPct, youBase),
      friend: theirs === undefined ? null : rebase(theirs, friendBase),
    });
  }
  if (out.length < 2) return null;
  return { anchor: points[at].day, points: out };
}
