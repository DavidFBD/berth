/**
 * CoinGecko coin ids for deposit tokens the SODAX money market oracle can't
 * price. The oracle only knows its own reserves, which leaves roughly a third
 * of the solver token list without a USD value — and without one, a holding
 * can't be sorted by worth, summed into the teapot total, or poured in dollars.
 *
 * Ids are resolved and verified against the live API, never guessed from the
 * symbol: several of these symbols collide on CoinGecko (WBTC alone matches a
 * dozen bridged variants), so the canonical id is pinned here by hand. Symbols
 * are matched case-insensitively and are assumed to mean the same asset on
 * every chain they appear on, which holds for this set.
 *
 * Deliberately absent: SODAX's own wrappers (soda*, lsoda*, bnUSD, IbnUSD),
 * which have no independent listing, and mSUI / yapSUI / trevinSUI, which
 * CoinGecko doesn't list at all. Those simply stay unpriced.
 */
export const COINGECKO_IDS: Readonly<Record<string, string>> = {
  AAVE: "aave",
  LINK: "chainlink",
  UNI: "uniswap",
  PEPE: "pepe",
  ENA: "ethena",
  USDe: "ethena-usde",
  sUSDe: "ethena-staked-usde",
  sUSDat: "saturn-susdat",
  PYUSD: "paypal-usd",
  ZRO: "layerzero",
  PAXG: "pax-gold",
  XAUt: "tether-gold",
  USD1: "usd1-wlfi",
  DAI: "dai",
  cbBTC: "coinbase-wrapped-btc",
  WBTC: "wrapped-bitcoin",
  rETH: "rocket-pool-eth",
  BONK: "bonk",
  JUP: "jupiter-exchange-solana",
  mSOL: "msol",
  RAY: "raydium",
  PYTH: "pyth-network",
  JTO: "jito-governance-token",
  CRCLx: "circle-xstock",
  TSLAx: "tesla-xstock",
  SPYx: "sp500-xstock",
  NVDAx: "nvidia-xstock",
  QQQx: "nasdaq-xstock",
  MSTRx: "microstrategy-xstock",
  COINx: "coinbase-xstock",
  GOOGLx: "alphabet-xstock",
  afSUI: "aftermath-staked-sui",
  haSUI: "haedal-staked-sui",
  vSUI: "volo-staked-sui",
  DEEP: "deep",
  WAL: "walrus-2",
  NAVX: "navi",
  RBNT: "redbelly-network-token",
};

/** Lowercased symbol → coin id, for case-insensitive lookup. */
export const COINGECKO_ID_BY_LOWER_SYMBOL: Readonly<Record<string, string>> =
  Object.fromEntries(
    Object.entries(COINGECKO_IDS).map(([symbol, id]) => [
      symbol.toLowerCase(),
      id,
    ]),
  );
