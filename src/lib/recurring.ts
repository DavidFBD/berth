import { COPY } from "@/lib/copy";
import { TOKEN_LISTINGS, type TokenListing } from "@/lib/listings";

/**
 * Recurring buys (docs/adr/0007): the rulebook, pure, shared by the server
 * (lib/server/recurring, the morning run) and the page. Berth reminds you,
 * you sign. Nothing here buys, reserves or signs anything: a plan is a
 * listing, a dollar amount and a day, and each time it comes due Berth
 * makes a run with a draft attached, which the person opens and signs or
 * lets pass.
 *
 * Days are read in the person's own time zone. A run comes due at the
 * start (local midnight) of its day. Monthly plans take a day from 1 to 28,
 * so no month ever skips. No XP for how often, and no streaks.
 */

/** The page's query for plans and ready runs (hooks/use-recurring); a buy or a limit record refreshes it. */
export const RECURRING_QUERY_KEY = ["recurring"] as const;

export const MAX_PLANS = 10;
export const MIN_PLAN_USD = 1;
export const MAX_PLAN_USD = 10_000;
/** A run nobody opened or signed is skipped this many days after it came due. */
export const SKIP_AFTER_DAYS = 3;
/**
 * The morning run (06:00 UTC, anywhere in that hour on Hobby) takes every
 * run whose day starts within this many hours, so a Monday plan in the
 * Americas is not a day late. The local hour the reminder lands varies by
 * zone (ADR-0007): about 23:00 the evening before in Los Angeles, early
 * morning in Europe, mid afternoon in Tokyo. So the copy says a buy "is
 * ready", never "this morning".
 */
export const MORNING_LOOKAHEAD_HOURS = 5;
/** How far an order's dollars may be from the plan's and still be its run: fees and pay token prices move. */
export const AMOUNT_TOLERANCE = 0.1;
/** "Buy on the dip": how far under the price the limit may sit. */
export const MAX_DIP_PCT = 50;

export type Cadence = "weekly" | "monthly";
export type RunStatus = "due" | "opened" | "placed" | "skipped";

export type PlanInput = {
  listing: string;
  usd: number;
  cadence: Cadence;
  /** 0 Sunday to 6 Saturday; weekly only. */
  weekday?: number | null;
  /** 1 to 28; monthly only. */
  monthDay?: number | null;
  timeZone: string;
  orderType?: "market" | "limit";
  dipPct?: number | null;
};

export type PlanSchedule = {
  cadence: Cadence;
  weekday: number | null;
  monthDay: number | null;
  timeZone: string;
};

/** A plan as the page and the tools read it (lib/server/recurring listPlans). */
export type PlanView = {
  id: string;
  symbol: string;
  usd: number;
  cadence: Cadence;
  weekday: number | null;
  monthDay: number | null;
  timeZone: string;
  orderType: "market" | "limit";
  dipPct: number | null;
  paused: boolean;
  nextDueAt: string;
  createdVia: "app" | "assistant";
  /** The last few runs, newest first. */
  runs: RunView[];
};

export type RunView = {
  id: string;
  planId: string;
  dueAt: string;
  status: RunStatus;
  limitPrice: number | null;
};

export type RecurringResponse = { plans: PlanView[]; ready: ReadyRun[]; limitAllowed: boolean };

/** A run waiting for the person: what the strip says and what the drawer opens with. */
export type ReadyRun = RunView & { symbol: string; usd: number; cadence: Cadence; timeZone: string; orderType: "market" | "limit" };

/** A plan's or a run's id: a real uuid, so a malformed one is a bad request, never a database error. */
export const RECURRING_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidTimeZone(zone: unknown): zone is string {
  if (typeof zone !== "string" || zone.length === 0 || zone.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Stocks and funds only: parking cash on a schedule is not what this is for. */
export function planListing(query: string | null | undefined): TokenListing | undefined {
  const wanted = query?.trim().toUpperCase();
  const listing = TOKEN_LISTINGS.find((candidate) => candidate.symbol === wanted);
  return listing?.kind === "stock" ? listing : undefined;
}

export type CheckedPlan =
  | {
      ok: true;
      plan: {
        symbol: string;
        usd: number;
        schedule: PlanSchedule;
        orderType: "market" | "limit";
        dipPct: number | null;
      };
    }
  | { ok: false; reason: "listing" | "amount" | "day" | "time_zone" | "limit_off" | "dip" };

/** Checks a plan as typed (the sheet, the API, the Assistant's draft). */
export function checkPlan(input: PlanInput, { limitAllowed }: { limitAllowed: boolean }): CheckedPlan {
  const listing = planListing(input.listing);
  if (!listing) return { ok: false, reason: "listing" };
  const usd = Number(input.usd);
  if (!Number.isFinite(usd) || usd < MIN_PLAN_USD || usd > MAX_PLAN_USD) return { ok: false, reason: "amount" };
  if (!isValidTimeZone(input.timeZone)) return { ok: false, reason: "time_zone" };
  let schedule: PlanSchedule;
  if (input.cadence === "weekly") {
    const day = Number(input.weekday);
    if (!Number.isInteger(day) || day < 0 || day > 6) return { ok: false, reason: "day" };
    schedule = { cadence: "weekly", weekday: day, monthDay: null, timeZone: input.timeZone };
  } else if (input.cadence === "monthly") {
    const day = Number(input.monthDay);
    if (!Number.isInteger(day) || day < 1 || day > 28) return { ok: false, reason: "day" };
    schedule = { cadence: "monthly", weekday: null, monthDay: day, timeZone: input.timeZone };
  } else {
    return { ok: false, reason: "day" };
  }
  const orderType = input.orderType === "limit" ? "limit" : "market";
  let dipPct: number | null = null;
  if (orderType === "limit") {
    if (!limitAllowed) return { ok: false, reason: "limit_off" };
    const dip = Number(input.dipPct);
    if (!Number.isFinite(dip) || dip <= 0 || dip > MAX_DIP_PCT) return { ok: false, reason: "dip" };
    dipPct = Number(dip.toFixed(2));
  }
  return { ok: true, plan: { symbol: listing.symbol, usd: Number(usd.toFixed(2)), schedule, orderType, dipPct } };
}

/* ── Calendar arithmetic in a time zone ─────────────────────────────── */

type LocalDate = { year: number; month: number; day: number };

const partsFormatter = new Map<string, Intl.DateTimeFormat>();
function formatterFor(zone: string): Intl.DateTimeFormat {
  let formatter = partsFormatter.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    partsFormatter.set(zone, formatter);
  }
  return formatter;
}

/** The wall clock in `zone` at `instant`, as numbers. */
function wallClock(instant: number, zone: string) {
  const parts = Object.fromEntries(
    formatterFor(zone)
      .formatToParts(new Date(instant))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;
  return parts;
}

/** How far `zone` is ahead of UTC at `instant`, in milliseconds. */
function offsetAt(instant: number, zone: string): number {
  const wall = wallClock(instant, zone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** The person's calendar day at `instant`. */
export function localDate(instant: number, zone: string): LocalDate {
  const wall = wallClock(instant, zone);
  return { year: wall.year, month: wall.month, day: wall.day };
}

/**
 * The instant a local day starts in `zone`: its midnight, or, where a
 * daylight saving change skips midnight, the first moment that exists.
 */
export function startOfLocalDay(date: LocalDate, zone: string): number {
  const naive = Date.UTC(date.year, date.month - 1, date.day);
  let guess = naive - offsetAt(naive, zone);
  // Once more with the offset at the guess itself, which differs when a change falls in between.
  guess = naive - offsetAt(guess, zone);
  const landed = localDate(guess, zone);
  if (landed.year !== date.year || landed.month !== date.month || landed.day !== date.day) {
    // Midnight did not exist (the clocks jumped over it): step forward to the day's first hour.
    for (let step = 1; step <= 4; step += 1) {
      const later = guess + step * 1_800_000;
      const at = localDate(later, zone);
      if (at.year === date.year && at.month === date.month && at.day === date.day) return later - (later % 1_800_000);
    }
  }
  return guess;
}

function addDays(date: LocalDate, days: number): LocalDate {
  const moved = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: moved.getUTCFullYear(), month: moved.getUTCMonth() + 1, day: moved.getUTCDate() };
}

function weekdayOf(date: LocalDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

/** The first day the schedule names strictly after the local day `after`. */
export function nextScheduledDay(schedule: PlanSchedule, after: LocalDate): LocalDate {
  if (schedule.cadence === "weekly") {
    const wanted = schedule.weekday ?? 1;
    const gap = ((wanted - weekdayOf(after) + 7) % 7) || 7;
    return addDays(after, gap);
  }
  const wanted = schedule.monthDay ?? 1;
  if (after.day < wanted) return { year: after.year, month: after.month, day: wanted };
  const month = after.month === 12 ? 1 : after.month + 1;
  const year = after.month === 12 ? after.year + 1 : after.year;
  return { year, month, day: wanted };
}

/**
 * When a new plan (or one moved to a new day) first comes due: the next
 * day it names after today, in its own zone. Today never counts, so a plan
 * set right after a buy does not ask again the same day.
 */
export function firstDueAt(schedule: PlanSchedule, now: number): number {
  return startOfLocalDay(nextScheduledDay(schedule, localDate(now, schedule.timeZone)), schedule.timeZone);
}

/** The due after one that has come: the next day the schedule names after that day. */
export function dueAfter(schedule: PlanSchedule, dueAt: number): number {
  // A few hours in, so a day start moved by a daylight saving change still reads as its own day.
  const day = localDate(dueAt + 6 * 3_600_000, schedule.timeZone);
  return startOfLocalDay(nextScheduledDay(schedule, day), schedule.timeZone);
}

/** Whether the morning run at `now` should make this due's run. */
export function dueForMorning(dueAt: number, now: number): boolean {
  return dueAt <= now + MORNING_LOOKAHEAD_HOURS * 3_600_000;
}

/* ── The run's life ─────────────────────────────────────────────────── */

export type RunEvent = "open" | "place" | "skip" | "age";

/**
 * due → opened → placed, or skipped. Placed and skipped are final. A run
 * ages into skipped SKIP_AFTER_DAYS after it came due; skipping costs
 * nothing and is never framed as a loss. Answers the next status, or null
 * when the event changes nothing.
 */
export function nextRunStatus(status: RunStatus, event: RunEvent, dueAt: number, now: number): RunStatus | null {
  if (status === "placed" || status === "skipped") return null;
  switch (event) {
    case "open":
      return status === "due" ? "opened" : null;
    case "place":
      return "placed";
    case "skip":
      return "skipped";
    case "age":
      return now >= dueAt + SKIP_AFTER_DAYS * 86_400_000 ? "skipped" : null;
  }
}

/** Whether a recorded order is this run's: same listing, about the same dollars, inside its window. */
export function orderMatchesRun(
  run: { symbol: string; usd: number; dueAt: number; createdAt: number },
  order: { symbol: string; usd: number | null; at: number },
): boolean {
  if (order.symbol.toUpperCase() !== run.symbol.toUpperCase()) return false;
  if (order.usd === null || !Number.isFinite(order.usd)) return false;
  if (Math.abs(order.usd - run.usd) > run.usd * AMOUNT_TOLERANCE) return false;
  const opens = Math.min(run.dueAt, run.createdAt);
  return order.at >= opens && order.at <= run.dueAt + SKIP_AFTER_DAYS * 86_400_000;
}

/** A limit plan's price at reminder time: dip_pct under the live price, to the cent. */
export function dipPrice(price: number | undefined, dipPct: number | null): number | null {
  if (price === undefined || !Number.isFinite(price) || price <= 0 || dipPct === null) return null;
  const limit = Number((price * (1 - dipPct / 100)).toFixed(2));
  return limit > 0 ? limit : null;
}

/** "YYYY-MM-DD" of the local day before the next due: a dip order waits until then, so runs never pile up. */
export function dipExpiry(schedule: PlanSchedule, dueAt: number): string {
  const next = dueAfter(schedule, dueAt);
  const day = addDays(localDate(next + 6 * 3_600_000, schedule.timeZone), -1);
  return `${day.year}-${String(day.month).padStart(2, "0")}-${String(day.day).padStart(2, "0")}`;
}

/** The draft link a run opens (lib/draft-order readDraftParams reads it back, `run` included). */
export function runDraftUrl(
  origin: string,
  run: { id: string; symbol: string; usd: number; limitPrice: number | null; expires?: string },
): string {
  const url = new URL("/", origin);
  url.searchParams.set("open", run.symbol);
  url.searchParams.set("side", "buy");
  url.searchParams.set("usd", String(run.usd));
  if (run.limitPrice !== null) {
    url.searchParams.set("price", String(run.limitPrice));
    if (run.expires) url.searchParams.set("until", run.expires);
  }
  url.searchParams.set("run", run.id);
  return url.toString();
}

/** The plan sheet's deep link, prefilled (the Assistant's draft_recurring). Nothing is saved until the person saves. */
export function planDraftUrl(origin: string, plan: { symbol: string; usd: number; schedule: PlanSchedule; dipPct: number | null }): string {
  const url = new URL("/", origin);
  url.searchParams.set("plan", plan.symbol);
  url.searchParams.set("usd", String(plan.usd));
  url.searchParams.set("every", plan.schedule.cadence);
  url.searchParams.set("day", String(plan.schedule.cadence === "weekly" ? plan.schedule.weekday : plan.schedule.monthDay));
  if (plan.dipPct !== null) url.searchParams.set("dip", String(plan.dipPct));
  return url.toString();
}

export type PlanDraftParams = { symbol: string; usd?: number; cadence: Cadence; day?: number; dipPct?: number };

export function readPlanParams(params: URLSearchParams): PlanDraftParams | null {
  const symbol = params.get("plan")?.toUpperCase();
  if (!symbol) return null;
  const usd = Number(params.get("usd"));
  const day = Number(params.get("day"));
  const dip = Number(params.get("dip"));
  const cadence: Cadence = params.get("every") === "monthly" ? "monthly" : "weekly";
  return {
    symbol,
    cadence,
    ...(params.has("usd") && Number.isFinite(usd) && usd > 0 && { usd }),
    ...(params.has("day") && Number.isInteger(day) && { day }),
    ...(params.has("dip") && Number.isFinite(dip) && dip > 0 && { dipPct: dip }),
  };
}

export const PLAN_LINK_KEYS = ["plan", "usd", "every", "day", "dip"] as const;

/** The weekday's name, Sunday first, from the copy (COPY.recurring.weekdays). */
export const WEEKDAY_NAMES: readonly string[] = COPY.recurring.weekdays;

/** "1st", "2nd", "23rd": a day of the month as the copy says it. */
export const ordinal = (day: number): string => COPY.recurring.ordinal(day);

/** "6 October": a due day as the copy names it, in the plan's own zone. */
export function dueDayWords(dueAt: number | string, zone: string): string {
  const instant = typeof dueAt === "string" ? Date.parse(dueAt) : dueAt;
  return new Intl.DateTimeFormat(COPY.recurring.dateLocale, { timeZone: zone, day: "numeric", month: "long" }).format(
    new Date(instant + 6 * 3_600_000),
  );
}
