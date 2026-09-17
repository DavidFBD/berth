/**
 * Where a listing's price history comes from.
 *
 * The solver oracle gives one number: what a listing is worth right now. It
 * carries no history and no change, so a visitor can see a price and still
 * have no idea whether it has been climbing or falling. That shape has to
 * come from outside.
 *
 * None of these tokens has a DEX pool on Sonic (they are minted and priced
 * off chain by the solver, not discovered by an AMM), so there is no on chain
 * candle history for them anywhere. What does exist is the SAME Robinhood
 * token deployed on Robinhood's own chain, which CoinGecko lists and
 * DefiLlama serves keyless. That is a different deployment of the same
 * instrument tracking the same share, so it is the right shape for a
 * sparkline and a change figure, and the wrong thing to quote as the price:
 * the price stays the oracle's, because the oracle is what an order fills at.
 *
 * Ids are pinned by hand, never derived from the ticker: CoinGecko carries
 * five or more tokenised wrappers of the same stock (xStock, Ondo, bStocks,
 * Dinari, Coinbase), and a symbol match would silently pick another issuer's
 * token. Verified 2026-09-17: all thirteen answer
 * `coins.llama.fi/percentage/coingecko:<id>` and carry daily closes from
 * 2026-06-26 (SGOV from 2026-07-08).
 *
 * Deliberately absent: the xStock ids, which reach back a further ten months
 * for nine of the thirteen. They are a second issuer's wrapper, so mixing
 * them in per ticker would mean one row's line meant something different
 * from the next row's. When a one year range is built it takes them as a
 * declared second series, not as a silent backfill; the ids are listed in
 * docs/research/2026-09-17-newsfeeds-and-price-history.md.
 */

/** Ticker → the CoinGecko id of the same Robinhood token on Robinhood Chain. */
export const MARKET_ID_BY_SYMBOL: Readonly<Record<string, string>> = {
  SPCX: "spacex-robinhood-tokenized-stock",
  NVDA: "nvidia-robinhood-tokenized-stock",
  GME: "gamestop-robinhood-tokenized-stock",
  MSTR: "strategy-inc-robinhood-tokenized-stock",
  AAPL: "apple-robinhood-tokenized-stock",
  TSLA: "tesla-robinhood-tokenized-stock",
  MU: "micron-technology-robinhood-tokenized-stock",
  SNDK: "sandisk-corporation-robinhood-tokenized-stock",
  SPY: "spdr-s-p-500-etf-trust-robinhood-tokenized-stock",
  QQQ: "invesco-qqq-robinhood-tokenized-stock",
  SGOV: "ishares-0-3-month-treasury-bond-etf-robinhood-tokenized-stock",
  USO: "united-states-oil-fund-robinhood-tokenized-stock",
  SLV: "ishares-silver-trust-robinhood-tokenized-stock",
};

/** CoinGecko id → ticker, to read a keyed upstream response back. */
export const SYMBOL_BY_MARKET_ID: Readonly<Record<string, string>> =
  Object.fromEntries(
    Object.entries(MARKET_ID_BY_SYMBOL).map(([symbol, id]) => [id, symbol]),
  );
