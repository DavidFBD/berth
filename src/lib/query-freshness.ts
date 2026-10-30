/**
 * Which reads may be shown from the cache while they refetch.
 *
 * Display-only reads (the board's prices and moves, news, charts, friends,
 * profile) keep their last answer for DISPLAY_GC_MS after the last screen
 * using them closes, so a revisit paints at once and refreshes behind it.
 * The money path never does: quotes, balances behind Max or the gas gate,
 * holdings a signature uses, and order status keep React Query's default
 * (no placeholder, no extended keep) and are listed here so a test can hold
 * the line.
 */
export const DISPLAY_GC_MS = 30 * 60_000;

/** Hooks that sit on the money path. They must never use the display cache. */
export const MONEY_PATH_HOOK_FILES = [
  "use-pour-quote.ts",
  "use-gas-gate.ts",
  "use-native-gas-buffer.ts",
  "use-hub-holdings.ts",
  "use-account-holdings.ts",
  "use-limit-orders.ts",
  "use-delivery.ts",
  "use-robinhood-sell.ts",
  "use-robinhood-arrival.ts",
  "use-token-prices.ts",
  "use-listing-prices.ts",
] as const;
