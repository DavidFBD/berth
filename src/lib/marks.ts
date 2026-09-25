import { tradingDayCloses, withoutSpikes } from "@/lib/performance";

/**
 * The stored daily marks (table `marks`): one close per listing or
 * benchmark per market day, kept past DefiLlama's reach so a portfolio can
 * be drawn for as long as it has existed. Pure rules here; the fetching and
 * the SQL are in lib/server/marks.
 *
 * WHEN a mark is taken. DefiLlama's `/chart` answers one point per period
 * counted from the `start` it is given, so a daily point falls at whatever
 * time of day the request names (verified 2026-09-25: a start at 21:30 UTC
 * came back as points within two minutes of 21:30 every day). The board
 * reads with a rolling start and gets a time of day that drifts with the
 * clock; the stored marks name a fixed one instead: 21:30 UTC, half an hour
 * after the New York close in winter (21:00 UTC) and ninety minutes after
 * it in summer (20:00 UTC). A stored mark is therefore the day's close,
 * which is also what a person means by "the price on Tuesday".
 */

/** Minutes past midnight UTC at which a stored mark is taken. */
export const MARK_MINUTES = 21 * 60 + 30;

export type IsoDay = string;

/** The moment the mark for `day` is taken, as an ISO timestamp. */
export function markAsOf(day: IsoDay): string {
  const hours = String(Math.floor(MARK_MINUTES / 60)).padStart(2, "0");
  const minutes = String(MARK_MINUTES % 60).padStart(2, "0");
  return `${day}T${hours}:${minutes}:00.000Z`;
}

/** `day` plus `days` calendar days. */
export function addDays(day: IsoDay, days: number): IsoDay {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * `day` minus `months` calendar months, clamped to the end of a shorter
 * month (March 31 less one month is February 28 or 29, not March 3).
 */
export function subtractMonths(day: IsoDay, months: number): IsoDay {
  const [year, month, date] = day.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 - months, 1));
  const lastOfMonth = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(date, lastOfMonth));
  return target.toISOString().slice(0, 10);
}

/** The `/chart` start, in epoch seconds, whose daily points land at the mark time from `day`. */
export function markStartSeconds(day: IsoDay): number {
  return Math.floor(Date.parse(markAsOf(day)) / 1000);
}

export type StoredMark = { day: IsoDay; close: number };

/** How far past the mark time a point may fall and still be that day's mark. */
export const MARK_TOLERANCE_MINUTES = 30;

/** The nth Sunday of a month (1 based), as a day of the month. */
function nthSunday(year: number, month: number, n: number): number {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return 1 + ((7 - first) % 7) + (n - 1) * 7;
}

/**
 * The New York close on `day`, in minutes past midnight UTC: 16:00 in New
 * York is 20:00 UTC under daylight saving (second Sunday of March to first
 * Sunday of November) and 21:00 UTC otherwise. Early closes (13:00) come
 * sooner, which only widens what counts as after the close.
 */
export function closeUtcMinutes(day: IsoDay): number {
  const [year, month, date] = day.split("-").map(Number);
  const start = `${year}-03-${String(nthSunday(year, 3, 2)).padStart(2, "0")}`;
  const end = `${year}-11-${String(nthSunday(year, 11, 1)).padStart(2, "0")}`;
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(date).padStart(2, "0")}`;
  return iso >= start && iso < end ? 20 * 60 : 21 * 60;
}

/**
 * Only the points that are that day's close: taken after the New York
 * close and no later than half an hour past the mark time. DefiLlama
 * answers each slot with the nearest price it has; where it has one near
 * 21:30 it is used, and in its first weeks (late June to mid July 2026)
 * its daily prints for these tokens fall around 20:55 UTC, still after the
 * summer close. A point from before the close (or a slot still in the
 * future when the request is made, answered with a price from earlier in
 * the day) is a different price, not the close, and is not stored.
 */
export function onTheMark<T extends { timestamp: number }>(
  points: readonly T[],
  toleranceMinutes = MARK_TOLERANCE_MINUTES,
): T[] {
  return points.filter((point) => {
    const ms = point.timestamp * 1000;
    const day = new Date(ms).toISOString().slice(0, 10);
    const midnight = Date.parse(`${day}T00:00:00Z`);
    const afterClose = ms >= midnight + closeUtcMinutes(day) * 60_000;
    const notLate = ms <= Date.parse(markAsOf(day)) + toleranceMinutes * 60_000;
    return afterClose && notLate;
  });
}

/**
 * What a fetch of raw points means for the table, from `writeFrom` on.
 *
 * The board's two passes, in the board's order: market days only, then the
 * despike. Points before `writeFrom` are read as context and never written:
 * the despike cannot judge the first point of a series (there is no day
 * before it), so a fetch reaches a few days further back than it writes,
 * and every day it writes has a neighbour on each side except the newest,
 * which tomorrow's run judges again. `drop` names the market days the
 * despike removed, so a bad mark stored yesterday is taken out today; a
 * missing mark stays missing, it is never filled in.
 */
export function settleMarks(
  points: readonly { timestamp: number; price: number }[],
  writeFrom: IsoDay,
): { keep: StoredMark[]; drop: IsoDay[] } {
  const open = tradingDayCloses(points);
  const clean = withoutSpikes(open.dates, open.values);
  const kept = new Set(clean.dates);
  const keep: StoredMark[] = [];
  clean.dates.forEach((day, index) => {
    if (day >= writeFrom) keep.push({ day, close: clean.values[index] });
  });
  const drop = open.dates.filter((day) => day >= writeFrom && !kept.has(day));
  return { keep, drop };
}
