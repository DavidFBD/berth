/**
 * When the headlines column (Nasdaq RSS) goes back to its source, as pure
 * arithmetic so it can be tested without a clock or a network. The X
 * column has its own, stricter timetable in lib/x-schedule, because X bills
 * by the post and Nasdaq does not.
 *
 * Every fetch is keyed on a slot of wall-clock time, not on how old a cache
 * entry is. That difference is the fix for a quiet night: a cache that
 * revalidates after N minutes serves whatever it last had to the first
 * visitor of the morning and only then fetches, so the column opened on
 * yesterday's news. A new slot is a new key, a miss, and a fetch the
 * visitor waits a second for.
 *
 * Headlines take a quarter hour, and five minutes on a refresh.
 */

export const REFRESH_WINDOW_MS = 5 * 60 * 1000;
export const HEADLINES_WINDOW_MS = 15 * 60 * 1000;

/** Which slot `now` falls in, for a window of `windowMs`. */
export function slotOf(now: number, windowMs: number): number {
  return Math.floor(now / windowMs);
}
