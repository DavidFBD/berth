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
 * The nine standard NYSE closures, plus Good Friday. The same rules also
 * answer the question a person asks in the drawer, whether the share's own
 * market is open right now and when it opens next, so the regular session
 * (09:30 to 16:00 New York time, daylight saving included) and the three
 * 13:00 half days are modelled below. A half day counts as a trading day for
 * the marks, because the market was open and the close is real. Not
 * modelled: ad-hoc closures for national mourning or weather, which are
 * rare, unpredictable and cost at most one point in a line of eighty.
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

const earlyCloseCache = new Map<number, ReadonlySet<IsoDate>>();

/**
 * The days the market closes at 13:00 New York time: the Friday after
 * Thanksgiving always, and 3 July and 24 December when they fall Monday to
 * Thursday. On a Friday those two are the observed holiday itself, and on a
 * weekend there is no session to shorten.
 */
export function earlyCloses(year: number): ReadonlySet<IsoDate> {
  const cached = earlyCloseCache.get(year);
  if (cached) return cached;
  const thanksgiving = Number(nthWeekdayOf(year, 11, 4, 4).slice(8));
  const days = [iso(year, 11, thanksgiving + 1)];
  for (const [month, day] of [
    [7, 3],
    [12, 24],
  ] as const) {
    const index = weekday(year, month, day);
    if (index >= 1 && index <= 4) days.push(iso(year, month, day));
  }
  const set: ReadonlySet<IsoDate> = new Set(days);
  earlyCloseCache.set(year, set);
  return set;
}

const NEW_YORK = "America/New_York";

const newYorkParts = new Intl.DateTimeFormat("en-US", {
  timeZone: NEW_YORK,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** New York's wall clock at an instant, as the parts a UTC date would have. */
function newYorkWall(at: number): { date: IsoDate; asUtc: number } {
  const parts: Record<string, number> = {};
  for (const part of newYorkParts.formatToParts(new Date(at))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  const { year, month, day, hour, minute, second } = parts;
  return {
    date: iso(year, month, day),
    asUtc: Date.UTC(year, month - 1, day, hour, minute, second),
  };
}

/** The calendar day in New York at an instant. */
export function newYorkDate(now: Date): IsoDate {
  return newYorkWall(now.getTime()).date;
}

/**
 * The instant New York's clock reads `hour:minute` on `date`. Two passes
 * settle the offset; session times sit far from the 02:00 daylight saving
 * change, so there is never an ambiguous hour to resolve.
 */
export function newYorkInstant(date: IsoDate, hour: number, minute: number): Date {
  const [year, month, day] = date.split("-").map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  let at = wall;
  for (let pass = 0; pass < 2; pass += 1) {
    at = wall - (newYorkWall(at).asUtc - at);
  }
  return new Date(at);
}

/** One regular session: when it opens and closes, and whether it is a half day. */
export type Session = {
  date: IsoDate;
  open: Date;
  close: Date;
  early: boolean;
};

/** The regular session on a New York calendar day, or null when there is none. */
export function sessionOn(date: IsoDate): Session | null {
  if (!isTradingDay(date)) return null;
  const early = earlyCloses(Number(date.slice(0, 4))).has(date);
  return {
    date,
    open: newYorkInstant(date, 9, 30),
    close: newYorkInstant(date, early ? 13 : 16, 0),
    early,
  };
}

const DAY_MS = 86_400_000;

/** A New York calendar day moved by whole days. */
export function shiftDate(date: IsoDate, days: number): IsoDate {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** No gap between sessions is longer than a four day weekend; this is ample. */
const SEARCH_DAYS = 14;

/** Whether the regular session is under way at `now`. */
export function isOpen(now: Date): boolean {
  const session = sessionOn(newYorkDate(now));
  const at = now.getTime();
  return (
    session !== null &&
    at >= session.open.getTime() &&
    at < session.close.getTime()
  );
}

/** The next session that opens after `now`; during a session, the following one. */
export function nextOpen(now: Date): Date {
  const today = newYorkDate(now);
  for (let offset = 0; offset <= SEARCH_DAYS; offset += 1) {
    const session = sessionOn(shiftDate(today, offset));
    if (session && session.open.getTime() > now.getTime()) return session.open;
  }
  throw new Error(`No session within ${SEARCH_DAYS} days of ${now.toISOString()}`);
}

/** The most recent close at or before `now`. */
export function lastClose(now: Date): Date {
  const today = newYorkDate(now);
  for (let offset = 0; offset <= SEARCH_DAYS; offset += 1) {
    const session = sessionOn(shiftDate(today, -offset));
    if (session && session.close.getTime() <= now.getTime()) return session.close;
  }
  throw new Error(`No session within ${SEARCH_DAYS} days of ${now.toISOString()}`);
}

export type MarketStatus = {
  /** `early_close` is an open market that shuts at 13:00 today. */
  state: "open" | "early_close" | "closed";
  nextOpen: Date;
  lastClose: Date;
};

/** Everything a screen needs to say whether the share's market is open. */
export function marketStatus(now: Date): MarketStatus {
  const open = isOpen(now);
  const early = open && sessionOn(newYorkDate(now))!.early;
  return {
    state: open ? (early ? "early_close" : "open") : "closed",
    nextOpen: nextOpen(now),
    lastClose: lastClose(now),
  };
}

/**
 * When the next open falls, in words a person reads in their own zone:
 * "today", "tomorrow" or the weekday, and the clock time. `timeZone` and
 * `hour12` are the viewer's; the day words stay English like the copy.
 */
export function opensAt(
  open: Date,
  now: Date,
  timeZone: string,
  hour12: boolean,
): { day: "today" | "tomorrow" | string; time: string } {
  const dayOf = (at: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone }).format(at);
  const openDay = dayOf(open);
  const day =
    openDay === dayOf(now)
      ? "today"
      : openDay === dayOf(new Date(now.getTime() + DAY_MS))
        ? "tomorrow"
        : new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "long" }).format(open);
  const time = new Intl.DateTimeFormat(hour12 ? "en-US" : "en-GB", {
    timeZone,
    hour: hour12 ? "numeric" : "2-digit",
    minute: "2-digit",
    hour12,
  }).format(open);
  return { day, time };
}
