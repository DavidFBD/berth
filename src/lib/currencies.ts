/**
 * Display currencies. Everything internal stays USD (the money market oracle
 * only speaks USD); a currency is applied at the very last moment, as one
 * multiplication before formatting. Rates ride the existing CoinGecko call —
 * see /api/token-prices.
 */

import type { Money } from "@/lib/format";

export const CURRENCIES = ["USD", "EUR", "GBP", "JPY", "KRW", "AUD"] as const;

export type Currency = (typeof CURRENCIES)[number];

export const DEFAULT_CURRENCY: Currency = "USD";

export function isCurrency(value: unknown): value is Currency {
  return CURRENCIES.includes(value as Currency);
}

/** USD per 1 USD → currency multipliers, e.g. { EUR: 0.92 }. */
export type FxRates = Partial<Record<Currency, number>>;

/**
 * The money a component actually prints for a chosen currency. No FX rate
 * yet, or a degraded one (zero or negative), means speaking USD rather than
 * guessing: a wrong currency symbol on a right number is worse than a
 * moment of dollars.
 */
export function resolveMoney(
  currency: Currency,
  fx: FxRates | undefined,
): Money {
  const rate = fx?.[currency];
  return rate !== undefined && rate > 0
    ? { currency, rate }
    : { currency: "USD", rate: 1 };
}

/**
 * Whether an ECB reference rate dated `day` (YYYY-MM-DD, as Frankfurter
 * gives it) is more than a day old at `now`. The ECB fixes its rates around
 * 16:00 Frankfurt time, so a day's rate is counted from 15:00 UTC. Over a
 * weekend or a holiday Friday's rate stays in use, and from Saturday
 * afternoon on it is old enough to name its date. Unknown or malformed
 * dates are never called stale: there is nothing honest to show instead.
 */
export function fxRateStale(day: string | undefined, now: Date = new Date()): boolean {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const published = Date.parse(`${day}T15:00:00Z`);
  if (!Number.isFinite(published)) return false;
  return now.getTime() - published > 24 * 60 * 60 * 1000;
}

/** "Oct 3" for a rate's date, in English like the sentence around it. */
export function fxDayLabel(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
