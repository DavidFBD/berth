/**
 * When the first stock's card (components/first-look) is shown: from the
 * first buy of a stock or fund, for two weeks, until "Got it" closes it on
 * the account for good. Pure, so the clock is a unit test; the server reads
 * the dates (lib/server/first-stock) and the home adds what it alone knows,
 * that the account holds exactly one stock right now.
 */

export const FIRST_STOCK_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export type FirstStockState = {
  /** "Got it" was tapped on this account, on any device. */
  closed: boolean;
  /** Epoch ms of the account's first filled buy of a stock or fund; null when the ledger has none. */
  firstBuyAt: number | null;
  /** Epoch ms the account was created, the clock's fallback when an order never reached the ledger. */
  createdAt: number;
};

export type FirstStockResponse = FirstStockState & { show: boolean };

export function firstStockShows(state: FirstStockState, now = Date.now()): boolean {
  if (state.closed) return false;
  const since = state.firstBuyAt ?? state.createdAt;
  return now - since < FIRST_STOCK_DAYS * DAY_MS;
}
