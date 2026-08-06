/**
 * Display currencies. Everything internal stays USD (the money market oracle
 * only speaks USD); a currency is applied at the very last moment, as one
 * multiplication before formatting. Rates ride the existing CoinGecko call —
 * see /api/token-prices.
 */

export const CURRENCIES = ["USD", "EUR", "GBP", "JPY", "KRW", "AUD"] as const;

export type Currency = (typeof CURRENCIES)[number];

export const DEFAULT_CURRENCY: Currency = "USD";

export function isCurrency(value: unknown): value is Currency {
  return CURRENCIES.includes(value as Currency);
}

/** USD per 1 USD → currency multipliers, e.g. { EUR: 0.92 }. */
export type FxRates = Partial<Record<Currency, number>>;
