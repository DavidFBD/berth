/**
 * The arithmetic of the staff Budgets page and the morning alert, pure.
 *
 * A service has one or more meters, each in its own unit:
 *
 * - `prepaid`: a credit bought ahead. Staff read the balance off the
 *   provider's own dashboard and enter it with the moment they read it;
 *   remaining is that balance less what Berth metered since (an estimate).
 * - `monthly`: a ceiling that resets on the 1st, UTC (the Assistant's house
 *   budget, Resend's monthly quota). Remaining is the ceiling less this
 *   month's use.
 * - `daily`: a guard rail that resets at midnight UTC (X's post cap,
 *   Resend's day). Shown, never alerted: the app already stops at it.
 *
 * A meter is low when what is left is at or under its threshold, or when
 * the last seven days' pace would use it up within seven days (for a
 * monthly meter, only if that comes before the 1st). Nothing here is red:
 * the page says "Running low", calmly.
 */

export type MeterKind = "prepaid" | "monthly" | "daily";
export type MeterUnit = "usd" | "emails" | "posts";

export type MeterInput = {
  kind: MeterKind;
  unit: MeterUnit;
  /** Used today and this month (UTC), in the unit. */
  today: number;
  month: number;
  /** Used over the last seven days, today included. */
  last7: number;
  /** A monthly or daily meter's ceiling; unused for prepaid. */
  limit?: number | null;
  /** A prepaid meter's balance as entered, null when nobody entered one. */
  balance?: number | null;
  /** Used since the balance was read. */
  sinceBalance?: number | null;
  /** The level at or under which it is low; null takes defaultThreshold. */
  threshold?: number | null;
};

export type MeterStatus = {
  kind: MeterKind;
  unit: MeterUnit;
  today: number;
  month: number;
  /** What is left, or null when unknown (a prepaid meter nobody entered). */
  remaining: number | null;
  threshold: number | null;
  /** The last seven days' average per day. */
  burnPerDay: number;
  /** Days until what is left runs out at that pace; null when nothing is being used or nothing is known. */
  daysLeft: number | null;
  /** Days until a monthly or daily meter resets. */
  resetsInDays: number | null;
  low: boolean;
  why: "threshold" | "runway" | null;
  /** Remaining comes from Berth's own meter, not the provider's figure. */
  estimate: boolean;
};

/** How soon a run-out counts as low. */
export const RUNWAY_DAYS = 7;

/** Days left in the UTC month after `now`, fractional (the 1st at 00:00 UTC is the reset). */
export function daysToMonthEnd(now: Date): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  return (next - now.getTime()) / 86_400_000;
}

export function daysToDayEnd(now: Date): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return (next - now.getTime()) / 86_400_000;
}

/** The threshold when none was set: $1 of a prepaid credit, a fifth of a monthly budget, a tenth of a quota. */
export function defaultThreshold(input: Pick<MeterInput, "kind" | "unit" | "limit">): number | null {
  if (input.kind === "prepaid") return input.unit === "usd" ? 1 : null;
  if (input.kind === "monthly" && input.limit) return input.unit === "usd" ? input.limit * 0.2 : input.limit * 0.1;
  return null;
}

export function meterStatus(input: MeterInput, now: Date): MeterStatus {
  const burnPerDay = Math.max(0, input.last7) / 7;
  let remaining: number | null = null;
  let resetsInDays: number | null = null;
  if (input.kind === "prepaid") {
    remaining = input.balance === null || input.balance === undefined ? null : input.balance - Math.max(0, input.sinceBalance ?? 0);
  } else if (input.limit !== null && input.limit !== undefined) {
    remaining = input.limit - (input.kind === "monthly" ? input.month : input.today);
    resetsInDays = input.kind === "monthly" ? daysToMonthEnd(now) : daysToDayEnd(now);
  }
  const threshold = input.threshold ?? defaultThreshold(input);
  const daysLeft = remaining === null || burnPerDay <= 0 ? null : Math.max(0, remaining) / burnPerDay;
  let why: MeterStatus["why"] = null;
  if (input.kind !== "daily" && remaining !== null) {
    if (threshold !== null && remaining <= threshold) why = "threshold";
    else if (daysLeft !== null && daysLeft < RUNWAY_DAYS && (resetsInDays === null || daysLeft < resetsInDays)) why = "runway";
  }
  return {
    kind: input.kind,
    unit: input.unit,
    today: input.today,
    month: input.month,
    remaining,
    threshold,
    burnPerDay,
    daysLeft,
    resetsInDays,
    low: why !== null,
    why,
    estimate: input.kind === "prepaid",
  };
}

/** Whether any of a service's meters is low. */
export function anyLow(meters: readonly MeterStatus[]): boolean {
  return meters.some((meter) => meter.low);
}

/** The once a day key of a service's alert to one admin: one email per service per admin per UTC day. */
export function alertRef(service: string, adminId: string, now: Date): string {
  return `${service}:${now.toISOString().slice(0, 10)}:${adminId}`;
}

/** A threshold or balance typed on the Budgets page: a finite number at least zero, at most a million, else null. */
export function parseAmount(raw: unknown): number | null {
  const value = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw.replace(/[$,\s]/g, "")) : Number.NaN;
  return Number.isFinite(value) && value >= 0 && value <= 1_000_000 ? Math.round(value * 1e6) / 1e6 : null;
}
