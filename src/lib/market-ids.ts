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
 * token. Verified 2026-09-17: the first thirteen answer
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
  // The second shelf, verified 2026-09-30: each id's CoinGecko platform is
  // `robinhood` at the address pinned below, and each answers
  // `coins.llama.fi/chart` with daily closes from 2026-07-02.
  GOOGL: "alphabet-class-a-robinhood-tokenized-stock",
  AMZN: "amazon-robinhood-tokenized-stock",
  MSFT: "microsoft-robinhood-tokenized-stock",
  META: "meta-platforms-robinhood-tokenized-stock",
  CRCL: "circle-internet-group-robinhood-tokenized-stock",
  COIN: "coinbase-robinhood-tokenized-stock",
  PLTR: "palantir-technologies-robinhood-tokenized-stock",
  TSM: "taiwan-semiconductor-manufacturing-robinhood-tokenized-stock",
  AMD: "amd-robinhood-tokenized-stock",
  INTC: "intel-robinhood-tokenized-stock",
  BABA: "alibaba-robinhood-tokenized-stock",
  // The third shelf, verified 2026-10-29: each id is the one CoinGecko lists
  // with platform `robinhood` at the address pinned below.
  AMC: "amc-entertainment-holdings-inc-robinhood-token",
  HIMS: "hims-hers-health-inc-robinhood-token",
  LLY: "eli-lilly-robinhood-tokenized-stock",
  COST: "costco-robinhood-tokenized-stock",
  TTWO: "take-two-interactive-software-robinhood-tokenized-stock",
  RBLX: "roblox-robinhood-tokenized-stock",
  IBM: "international-business-machines-corporation-robinhood-token",
  MRNA: "moderna-inc-robinhood-token",
  LULU: "lululemon-robinhood-tokenized-stock",
  SNAP: "snap-inc-robinhood-token",
  WYFI: "whitefiber-inc-robinhood-token",
  RIVN: "rivian-automotive-robinhood-tokenized-stock",
  NFLX: "netflix-robinhood-tokenized-stock",
  BULL: "webull-corporation-robinhood-token",
  QUBT: "quantum-computing-robinhood-tokenized-stock",
  NET: "cloudflare-inc-robinhood-token",
  SKHY: "sk-hynix-robinhood-token",
  JNJ: "johnson-johnson-robinhood-token",
  UPS: "ups-robinhood-tokenized-stock",
  DJT: "trump-media-technology-group-corp-robinhood-token",
  RDDT: "reddit-robinhood-tokenized-stock",
  GLD: "spdr-gold-shares-robinhood-token",
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
  // Verified 2026-09-30 the same way, against the backend's `robinhood`
  // token list (whose NVDA entry is the NVDA pinned above) and on chain.
  GOOGL: "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3",
  AMZN: "0x12f190a9F9d7D37a250758b26824B97CE941bF54",
  MSFT: "0xe93237C50D904957Cf27E7B1133b510C669c2e74",
  META: "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35",
  CRCL: "0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5",
  COIN: "0x6330D8C3178a418788dF01a47479c0ce7CCF450b",
  PLTR: "0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A",
  TSM: "0x58FfE4a942d3885bAa22D7520691F611EF09e7AA",
  AMD: "0x86923f96303D656E4aa86D9d42D1e57ad2023fdC",
  INTC: "0xc72b96e0E48ecd4DC75E1e45396e26300BC39681",
  BABA: "0xad25Ac6C84D497db898fa1E8387bf6Af3532a1c4",
  // The third shelf, 2026-10-29: the backend's `robinhood` token list, whose
  // `vault` for each is the listing's Sonic address.
  AMC: "0x05a3d1Cd21d0C88145E82600E62e7E496e0F222B",
  HIMS: "0xCceE82fE024c36fA15E1005edE3E9e4787e23D09",
  LLY: "0x8005d266423c7ea827372c9c864491e5786600ea",
  COST: "0x4EA005168D7F09a7A0Ba9D1DEf21a479950E44C2",
  TTWO: "0x5e81213613b6B86EaB4c6c50d718d34359459786",
  RBLX: "0xF0C4BF4C582cb3836e98394b1d4e7B7281101bE8",
  IBM: "0x980dcf6766FA79f5Cf0c4AAdb3ab477ff15a9619",
  MRNA: "0x43B07D15cE533bEc5476d70C22a78a1B2B662155",
  LULU: "0x4e62068525Ab11FE768e29dfD00ef909B9803016",
  SNAP: "0xF6589F11Bc40b669e584073F428B05562F568733",
  WYFI: "0x9e7ABD3C9139D14E4c86DcE0e455AAB7A0C2FB3E",
  RIVN: "0xB1BF26c1D20ff267A4f93550d1E0d06ac40a114B",
  NFLX: "0xE0444EF8BF4eD74f74FD73686e2ddF4C1c5591E8",
  BULL: "0xceF9027c7d6985b85f0BA431125073529A947A68",
  QUBT: "0x59818904ab4cE163b3cE4FfB64f2D6Ca02c434B4",
  NET: "0x116F00968269B7bfbaD4109cE591d6E74c0601d4",
  SKHY: "0x84CAb63bc87912E71ad199ff14A0bA45de68FeF8",
  JNJ: "0x03DfbBE0AC4E7bCDaFd08eD41A400326B77D8c80",
  UPS: "0xf23250dac154D05Bb671CB0d0eBEf3c635c79CE2",
  DJT: "0x1D11f0496982706C5e14A514D4E79F2e6BdE4516",
  RDDT: "0x05b37Fb53A299a1b874A619e1c4C404D52C36F4C",
  GLD: "0xC9a981FEE1F9DEc688bb123ccDeCc63D0deBFC4e",
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
