/**
 * When the US stock market is open, by rule rather than by list.
 *
 * A Robinhood Stock Token trades around the clock on a thin venue, and the
 * price history carries whatever mark existed at the time, including on days
 * the underlying market was shut. Those marks are not the share's price, and
 * they are not small: on 2026-09-05 to 2026-09-07, a Saturday, a Sunday and
 * Labor Day, the GameStop token's daily series sat at $34.44 while the same
 * stock's other wrapper read $19.20, and the Strategy token printed $266.01
 * on a Sunday against $130 on the Friday. Drawn unfiltered, a visitor would
 * be shown a seventy percent rally that the company never had.
 *
 * So the line and the change are built from days the market was open, and
 * everything else is dropped. The rules are computed, never pinned as dates,
 * because a hand-written holiday table goes stale in January and then
 * silently lets a bad mark back into the chart.
 *
 * The nine standard NYSE closures, plus Good Friday. Not modelled: half days
 * (the market is open, so the mark is real), and ad-hoc closures for national
 * mourning or weather, which are rare, unpredictable and cost at most one
 * point in a line of eighty.
 */

/** A calendar day as `YYYY-MM-DD`, always UTC. */
export type IsoDate = string;

const iso = (year: number, month: number, day: number): IsoDate =>
  `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

/** Day of week for a UTC date, 0 = Sunday. */
function weekday(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** The `nth` `weekdayWanted` of a month, e.g. the 3rd Monday of January. */
function nthWeekdayOf(
  year: number,
  month: number,
  weekdayWanted: number,
  nth: number,
): IsoDate {
  const first = weekday(year, month, 1);
  const offset = (weekdayWanted - first + 7) % 7;
  return iso(year, month, 1 + offset + (nth - 1) * 7);
}

/** The last `weekdayWanted` of a month, e.g. the last Monday of May. */
function lastWeekdayOf(
  year: number,
  month: number,
  weekdayWanted: number,
): IsoDate {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last = weekday(year, month, daysInMonth);
  return iso(year, month, daysInMonth - ((last - weekdayWanted + 7) % 7));
}

/**
 * The day a fixed-date holiday is actually observed: Saturday moves back to
 * the Friday, Sunday forward to the Monday.
 */
function observed(year: number, month: number, day: number): IsoDate {
  const shift = { 6: -1, 0: 1 }[weekday(year, month, day)] ?? 0;
  const date = new Date(Date.UTC(year, month - 1, day + shift));
  return date.toISOString().slice(0, 10);
}

/**
 * Western Easter Sunday, by the Meeus/Jones/Butcher algorithm. Needed only
 * because Good Friday is the one market holiday with no fixed rule.
 */
function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const total = h + l - 7 * m + 114;
  return { month: Math.floor(total / 31), day: (total % 31) + 1 };
}

const holidayCache = new Map<number, ReadonlySet<IsoDate>>();

/** Every day the US stock market is closed in a given year, besides weekends. */
export function marketHolidays(year: number): ReadonlySet<IsoDate> {
  const cached = holidayCache.get(year);
  if (cached) return cached;

  const easter = easterSunday(year);
  const goodFriday = new Date(
    Date.UTC(year, easter.month - 1, easter.day - 2),
  )
    .toISOString()
    .slice(0, 10);

  const days = [
    // New Year's Day never closes the market on the Friday before: when
    // January 1 falls on a Saturday, December 31 stays a full session.
    weekday(year, 1, 1) === 0 ? iso(year, 1, 2) : iso(year, 1, 1),
    nthWeekdayOf(year, 1, 1, 3), // Martin Luther King Jr. Day
    nthWeekdayOf(year, 2, 1, 3), // Washington's Birthday
    goodFriday,
    lastWeekdayOf(year, 5, 1), // Memorial Day
    observed(year, 6, 19), // Juneteenth
    observed(year, 7, 4), // Independence Day
    nthWeekdayOf(year, 9, 1, 1), // Labor Day
    nthWeekdayOf(year, 11, 4, 4), // Thanksgiving
    observed(year, 12, 25), // Christmas
  ];

  const set: ReadonlySet<IsoDate> = new Set(days);
  holidayCache.set(year, set);
  return set;
}

/** Whether the US stock market was open on a given UTC calendar day. */
export function isTradingDay(date: IsoDate): boolean {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return false;
  const weekdayIndex = weekday(year, month, day);
  if (weekdayIndex === 0 || weekdayIndex === 6) return false;
  return !marketHolidays(year).has(date);
}
