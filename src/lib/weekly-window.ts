import { addDays, type IsoDay } from "@/lib/marks";

/**
 * The weekly summary's calendar (lib/server/weekly), pure so the email
 * retry pass (lib/server/email/send) can tell a summary whose week is over
 * without importing the summary itself.
 */

/**
 * How many mornings a week's summary is tried: Monday to Thursday. Three
 * would do on a calm week; the fourth is for a Wednesday whose morning run
 * had no time left for it (lib/server/morning), so the week still reaches
 * whoever it had not.
 */
export const WEEKLY_SEND_DAYS = 4;

export type WeeklyWindow = {
  /** The summarised week's Monday and Sunday. */
  monday: IsoDay;
  sunday: IsoDay;
  /** "2026-W39": the ISO week, the first half of each send's ref. */
  key: string;
  /** Monday 00:00 UTC and the next Monday 00:00 UTC: what counts as in the week. */
  from: Date;
  to: Date;
};

/** The ISO week "YYYY-Www" of a Monday. */
export function isoWeekKey(monday: IsoDay): string {
  const thursday = new Date(`${addDays(monday, 3)}T00:00:00Z`);
  const year = thursday.getUTCFullYear();
  const dayOfYear = Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / 86_400_000) + 1;
  return `${year}-W${String(Math.floor((dayOfYear - 1) / 7) + 1).padStart(2, "0")}`;
}

/**
 * The week a morning run at `now` would summarise, or null on a morning
 * that sends none (Friday to Sunday).
 */
export function weeklyWindow(now: Date): WeeklyWindow | null {
  const sinceMonday = (now.getUTCDay() + 6) % 7;
  if (sinceMonday >= WEEKLY_SEND_DAYS) return null;
  const thisMonday = addDays(now.toISOString().slice(0, 10), -sinceMonday);
  const monday = addDays(thisMonday, -7);
  return {
    monday,
    sunday: addDays(monday, 6),
    key: isoWeekKey(monday),
    from: new Date(`${monday}T00:00:00Z`),
    to: new Date(`${thisMonday}T00:00:00Z`),
  };
}

export function weeklyRef(window: WeeklyWindow, userId: string): string {
  return `${window.key}:${userId}`;
}

/** The ISO week a weekly send's ref names ("2026-W39:<user id>"), or null when it names none. */
export function weekOfRef(ref: string): string | null {
  const match = /^(\d{4}-W\d{2}):/.exec(ref);
  return match ? match[1] : null;
}

/** Whether a weekly summary with this ref may still go out at `now`: only on its own Monday to Thursday. */
export function weeklyRefCurrent(ref: string, now: Date): boolean {
  const week = weekOfRef(ref);
  return week !== null && week === weeklyWindow(now)?.key;
}
