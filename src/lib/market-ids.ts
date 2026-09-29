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

/**
 * Ticker → the same Robinhood token's contract on Robinhood Chain (chain
 * 4663), where its `uiMultiplier()` lives: the shares one token stands for,
 * which grows as dividends are reinvested (lib/token-multiplier). The token
 * on Sonic is SODAX's wrapper of one of these, unit for unit, and has no
 * multiplier of its own. Verified 2026-09-29 against Robinhood's
 * `/rhj/assets` (each listing's one deployment) and on chain: every address
 * answers the listing's `symbol()` and a `uiMultiplier()`.
 */
export const ROBINHOOD_CHAIN_ADDRESS_BY_SYMBOL: Readonly<Record<string, `0x${string}`>> = {
  SPCX: "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa",
  NVDA: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC",
  GME: "0x1b0E319c6A659F002271B69dB8A7df2F911c153E",
  MSTR: "0xec262a75e413fAfD0dF80480274532C79D42da09",
  AAPL: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9",
  TSLA: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d",
  MU: "0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD",
  SNDK: "0xB90A19fF0Af67f7779afF50A882A9CfF42446400",
  SPY: "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C",
  QQQ: "0xD5f3879160bc7c32ebb4dC785F8a4F505888de68",
  SGOV: "0x92FD66527192E3e61d4DDd13322Aa222DE86F9B5",
  USO: "0xa30FA36Db767ad9eD3f7a60fC79526fB4d56D344",
  SLV: "0x411eFb0E7f985935DAec3D4C3ebaEa0d0AD7D89f",
};

/** CoinGecko id → ticker, to read a keyed upstream response back. */
export const SYMBOL_BY_MARKET_ID: Readonly<Record<string, string>> =
  Object.fromEntries(
    Object.entries(MARKET_ID_BY_SYMBOL).map(([symbol, id]) => [id, symbol]),
  );

/**
 * Benchmark-only instruments: priced for comparison, never offered. They
 * are not listings, so they stay out of the board's map above and out of
 * TOKEN_LISTINGS; only the stored marks (lib/server/marks) fetch them.
 * PAX Gold is one troy ounce of gold per token, which makes it the gold
 * price; bitcoin is bitcoin. Verified 2026-09-25: both answer
 * `coins.llama.fi/chart` with a full year of daily points.
 */
export const BENCHMARK_ONLY_MARKET_ID_BY_SYMBOL: Readonly<Record<string, string>> = {
  PAXG: "pax-gold",
  BTC: "bitcoin",
};

/** Everything the stored marks carry: every listing plus the benchmark-only ids. */
export const MARKS_MARKET_ID_BY_SYMBOL: Readonly<Record<string, string>> = {
  ...MARKET_ID_BY_SYMBOL,
  ...BENCHMARK_ONLY_MARKET_ID_BY_SYMBOL,
};

/** CoinGecko id → symbol, across the stored marks. */
export const SYMBOL_BY_MARKS_MARKET_ID: Readonly<Record<string, string>> =
  Object.fromEntries(
    Object.entries(MARKS_MARKET_ID_BY_SYMBOL).map(([symbol, id]) => [id, symbol]),
  );
