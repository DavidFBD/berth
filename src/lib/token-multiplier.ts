/**
 * What one Robinhood stock token is worth, given a price for the share.
 *
 * A Robinhood token does not stay one share. When the company pays a
 * dividend, Robinhood reinvests it (less US withholding) by raising the
 * token's `uiMultiplier()` on Robinhood Chain: after SGOV's third monthly
 * dividend one token stands for 1.005101770003214918 shares. The token on
 * Sonic that a Berth account holds is SODAX's wrapper of that token, unit
 * for unit, so it carries the multiplier too. What a token is worth is
 * therefore the share's price times the multiplier in force at that moment.
 *
 * The solver oracle already prices the token (SGOV 101.1786 on 2026-09-29,
 * against Robinhood's own token bid 101.1836 = share bid 100.67 x 1.0051).
 * DefiLlama does not, and not consistently: until 2026-09-02 about 13:05
 * UTC its `coingecko:` prices for these ids were the token's own (SGOV
 * 100.9546 on 09-01, with the share at 100.41 and the multiplier 1.00298),
 * and from then on they are Robinhood's share quote, rounded to half a
 * cent (SGOV 100.415 at 13:14 UTC on 09-02). Every listing switched in the
 * same minute. So a DefiLlama price taken before the switch is already the
 * token's, and one taken after needs the multiplier in force when it was
 * taken.
 *
 * Pure: the multiplier history is read elsewhere (lib/server/token-
 * multipliers) and handed in.
 */

/** The multiplier's fixed point, as the contract stores it. */
export const MULTIPLIER_ONE = 10n ** 18n;

/**
 * The first moment DefiLlama's price for a Robinhood token is the share's
 * and not the token's. Its last token print is 13:01:40 UTC on 2026-09-02,
 * its first share print 13:14:30 (both read from `/prices/historical`,
 * SGOV and NVDA alike).
 */
export const LLAMA_SHARE_QUOTES_FROM_MS = Date.parse("2026-09-02T13:05:00Z");

/** One `UIMultiplierUpdated(old, new, effectiveAt)` event. */
export type MultiplierChange = {
  from: number;
  to: number;
  /** When `to` takes effect, epoch seconds (may lie ahead of the event). */
  effectiveAt: number;
};

/**
 * A token's multiplier over a window: `current` as `uiMultiplier()` reads
 * now, and every change whose event fell inside the window. The window
 * must reach back to the earliest moment asked about.
 */
export type MultiplierHistory = {
  current: number;
  changes: readonly MultiplierChange[];
};

/** A contract's 18 decimal fixed point as a number (1005101770003214918n → 1.0051…). */
export function multiplierFromFixed(raw: bigint): number {
  const whole = raw / MULTIPLIER_ONE;
  const fraction = raw % MULTIPLIER_ONE;
  return Number(whole) + Number(fraction) / 1e18;
}

/**
 * The multiplier in force at `atMs`. The last change that had taken
 * effect by then gives its `to`; before the window's first change, that
 * change's `from`; with no change in the window, `current`.
 */
export function multiplierAt(history: MultiplierHistory, atMs: number): number {
  const changes = [...history.changes].sort((a, b) => a.effectiveAt - b.effectiveAt);
  if (changes.length === 0) return history.current;
  let multiplier = changes[0].from;
  for (const change of changes) {
    if (change.effectiveAt * 1000 > atMs) break;
    multiplier = change.to;
  }
  return multiplier;
}

/** Whether DefiLlama's price taken at `atMs` is the share's, and needs the multiplier. */
export function llamaQuotesShares(atMs: number): boolean {
  return atMs >= LLAMA_SHARE_QUOTES_FROM_MS;
}

/**
 * The token's price from DefiLlama's price for it taken at `atMs`. Before
 * the switch the price is the token's already and is returned as is.
 */
export function llamaTokenPrice(price: number, atMs: number, history: MultiplierHistory): number {
  return llamaQuotesShares(atMs) ? price * multiplierAt(history, atMs) : price;
}
