/**
 * The smallest order Berth takes, in USD, for every way in: the buy and sell
 * drawers, limit orders, recurring plans, and the drafts the Assistant and
 * connected AIs prepare. One number, so no door promises what another refuses.
 *
 * Why $1.50. The solver refuses an order whose input, after the partner fee is
 * taken, is worth under one dollar by its own oracle: it answers "Input amount
 * too low". Measured read only on 2026-10-01 (POST /intent/quote, exact_input,
 * no signatures): USDC on Base, Solana, Arbitrum, Ethereum, Polygon and Sonic,
 * USDT on BSC, ETH on Base and SOL on Solana into NVDA, SPY, SGOV and TSLA
 * all refused a $1.00 order (worth $0.996 after the 0.4% fee) and all routed
 * from $1.006, SOL from $1.004; sells of NVDA, SGOV and TSLA into USDC on Base,
 * Solana and Arbitrum refused $1.00 and routed from $1.01. The floor is the
 * same on every chain and every pair because it is one rule on the hub. Half a
 * dollar over it leaves a third of room for a pay token's price to move while
 * a limit order waits, and for the app's price and the solver's to disagree.
 */
export const MIN_ORDER_USD = 1.5;

/** "$1.50", for model facing text and USD only copy; drawers format it in the viewer's currency. */
export const MIN_ORDER_LABEL = Number.isInteger(MIN_ORDER_USD)
  ? `$${MIN_ORDER_USD}`
  : `$${MIN_ORDER_USD.toFixed(2)}`;

/**
 * Whether a solver error is its too small refusal rather than a missing route.
 * The SDK hands the solver's body back as the Result's error: `{ detail: {
 * code, message } }`, with message "Input amount too low".
 */
export function isTooSmallQuoteError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const detail = (error as { detail?: unknown }).detail;
  const message =
    detail && typeof detail === "object" ? (detail as { message?: unknown }).message : undefined;
  return typeof message === "string" && /amount too low/i.test(message);
}
