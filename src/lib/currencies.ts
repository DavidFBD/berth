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
