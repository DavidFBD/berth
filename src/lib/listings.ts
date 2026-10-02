import {
  ChainKeys,
  type Address,
  type LeverageYieldVault,
  type XToken,
} from "@sodax/sdk";
import type { CompanyMarkId } from "@/components/company-marks";

/**
 * The house's listings: every asset a pour can land in on the Sonic hub.
 *
 * Until 2026-09-16 the only destinations were the four lsoda* vaults, and
 * that assumption was baked in as `sodax.leverageYield.listVaults()` at every
 * call site. A listing is the general shape: a vault (one of the cups), a
 * stock (a Robinhood Stock Token, an ERC-20 on Sonic) or cash (the SGOV
 * Treasury ETF token, which is a stock token too, but plays the role of the
 * idle-dollar shelf). The vault entries still come from the SDK registry;
 * the token entries are pinned here by address.
 *
 * Why pinned, not read live: @sodax/sdk 2.0.0 knows none of these tokens in
 * either static table (`sonicSupportedTokens`, `getSupportedSolverTokens`),
 * and the SDK config is a module constant frozen at first render, so the
 * table has to exist at import time. The backend does serve them
 * (`GET /v1/swaps/tokens/sonic` lists 63 tokens on 2026-09-30, these
 * twenty four among them, each flagged `isRwa`),
 * and `pnpm listings:verify` diffs this file against that live list AND
 * against `symbol()` / `decimals()` read on chain, so drift fails loudly
 * instead of shipping.
 *
 * Verified on chain 2026-09-16, and 2026-09-30 for the second shelf
 * (sonic-rpc.publicnode.com): every address
 * below answers the symbol in `symbol`, the name in `issuerName`, and 18
 * decimals. The backend's hub-asset table lists each with
 * `asset === vault === address`, so for these tokens the tradeable ERC-20 and
 * the hub asset are one contract; there is no separate vault wrapper to be
 * confused with, unlike USDC (asset 0x2921…, vault sodaUSDC 0xAbbb…).
 */

export type StockCategory =
  /** A listed company's common stock. */
  | "equity"
  /** An exchange-traded fund on an index or a commodity. */
  | "etf"
  /** A short-dated US Treasury ETF: the cash shelf. */
  | "treasury";

/** A Robinhood Stock Token on Sonic, or the Treasury token that plays cash. */
export type TokenListing = {
  kind: "stock" | "cash";
  /** The ticker, exactly as the token's on-chain `symbol()`: NVDA, SPY, SGOV. */
  symbol: string;
  /** Plain display name: "NVIDIA", "S&P 500 ETF". Never the ticker. */
  name: string;
  /**
   * The name a narrow row shows where `name` would not fit on an iPhone,
   * and only where the company goes by it in everyday speech ("TSMC",
   * "AMD"). Everything else, from the buy sheet to the assistant, says
   * `name`.
   */
  shortName?: string;
  /** The token's on-chain `name()`, verbatim, for the ownership screen. */
  issuerName: string;
  category: StockCategory;
  /** The ERC-20 on Sonic. For these tokens the hub asset IS this address. */
  address: Address;
  decimals: 18;
  /** The wrapper whose legal terms apply. One wrapper at launch. */
  wrapper: "robinhood";
};

/** One of the cups, in listing shape. Everything on-chain stays on `vault`. */
export type VaultListing = {
  kind: "vault";
  /** The lsoda* share token symbol, which is also the registry name. */
  symbol: string;
  name: string;
  /** The vault proxy, which doubles as the share token. */
  address: Address;
  decimals: 18;
  vault: LeverageYieldVault;
};

export type Listing = TokenListing | VaultListing;

const robinhood = (
  kind: TokenListing["kind"],
  symbol: string,
  name: string,
  issuerName: string,
  category: StockCategory,
  address: Address,
): TokenListing => ({
  kind,
  symbol,
  name,
  issuerName,
  category,
  address,
  decimals: 18,
  wrapper: "robinhood",
});

/**
 * The Robinhood tokens the solver trades on Sonic, in the order the backend
 * lists them: thirteen as of 2026-09-16, twenty four as of 2026-09-30.
 * Twenty three are stocks and ETFs; SGOV is cash. Addresses are EIP-55 as
 * the backend serves them.
 */
export const TOKEN_LISTINGS: readonly TokenListing[] = [
  // SpaceX was private when this registry was written on 2026-09-16. It
  // listed on Nasdaq under SPCX on 2026-07-01 (SEC CIK 1181412, filing 8-Ks
  // and Form 4s since), so it is ordinary listed equity and the token's own
  // name said so all along: Class A Common Stock.
  robinhood(
    "stock",
    "SPCX",
    "SpaceX",
    "Space Exploration Technologies Corp. Class A Common Stock • Robinhood Token",
    "equity",
    "0xB585e2EEa070eB4E4D877A707aEC3B718edb2373",
  ),
  robinhood(
    "stock",
    "NVDA",
    "NVIDIA",
    "NVIDIA • Robinhood Token",
    "equity",
    "0x2D5D2250EE426cA318efBd03ddf926B23c96f74B",
  ),
  robinhood(
    "stock",
    "GME",
    "GameStop",
    "GameStop • Robinhood Token",
    "equity",
    "0x996e5591e4692e2B7d8fB6926DeA4EE1950Ef394",
  ),
  robinhood(
    "stock",
    "MSTR",
    "Strategy",
    "Strategy Inc. • Robinhood Token",
    "equity",
    "0xE0E2aF45EBf5700a90E63c41B0ecE042A240Fab1",
  ),
  robinhood(
    "stock",
    "AAPL",
    "Apple",
    "Apple • Robinhood Token",
    "equity",
    "0x4712D2D49Ba3be41DA334FCB3616FDdc0d745185",
  ),
  robinhood(
    "stock",
    "TSLA",
    "Tesla",
    "Tesla • Robinhood Token",
    "equity",
    "0x8B7F46967Ed9367A70b2e046D5e26a03625d53b1",
  ),
  robinhood(
    "stock",
    "MU",
    "Micron",
    "Micron Technology • Robinhood Token",
    "equity",
    "0x108147b16186B895344F5752468190B9EE0e3A22",
  ),
  robinhood(
    "stock",
    "SNDK",
    "Sandisk",
    "Sandisk Corporation • Robinhood Token",
    "equity",
    "0x568F29855B7B46EdA38ed95771FAeC498c507EF7",
  ),
  robinhood(
    "stock",
    "SPY",
    "S&P 500 ETF",
    "SPDR S&P 500 ETF Trust • Robinhood Token",
    "etf",
    "0x1816E408f0448D0CaD3e0D490bd2590d921Bb0c8",
  ),
  robinhood(
    "stock",
    "QQQ",
    "Nasdaq 100 ETF",
    "Invesco QQQ • Robinhood Token",
    "etf",
    "0x454ab3DeFd9df0749d450b145D4516e317E3e500",
  ),
  robinhood(
    "cash",
    "SGOV",
    "Treasury ETF",
    "iShares 0-3 Month Treasury Bond • Robinhood Token",
    "treasury",
    "0xf6938087cf794B08739b926B41FF8F1E90816E74",
  ),
  robinhood(
    "stock",
    "USO",
    "Oil Fund",
    "United States Oil Fund • Robinhood Token",
    "etf",
    "0x8DaBbADcecfc1a0B91fc68c72301090bc220D2bc",
  ),
  robinhood(
    "stock",
    "SLV",
    "Silver Trust",
    "iShares Silver Trust • Robinhood Token",
    "etf",
    "0x690B92c27ac80015E57DB8cc02A81255814f49A2",
  ),
  // The second shelf, served by the backend from late September 2026 and
  // pinned 2026-09-30: eleven more companies, all US listed common stock
  // (TSM and BABA are the American depositary shares on the NYSE, which is
  // the instrument Robinhood tokenises). Checked the same way as the first
  // thirteen, and each one quoted both ways by the solver from Base USDC.
  robinhood(
    "stock",
    "GOOGL",
    "Alphabet",
    "Alphabet Class A • Robinhood Token",
    "equity",
    "0xBdB4445a05726E26C26EA30dF0C1970DF4Cf4Be3",
  ),
  robinhood(
    "stock",
    "AMZN",
    "Amazon",
    "Amazon • Robinhood Token",
    "equity",
    "0xc467cAC3e69C2eb41Cc9b32Aa1A7a54F942243Ba",
  ),
  robinhood(
    "stock",
    "MSFT",
    "Microsoft",
    "Microsoft • Robinhood Token",
    "equity",
    "0x66A3bc5a66D3c66dc42031775Ea3eedc37347FeC",
  ),
  robinhood(
    "stock",
    "META",
    "Meta",
    "Meta Platforms • Robinhood Token",
    "equity",
    "0xB7686E0a03542230927CAC76Fe7566656439F3c6",
  ),
  robinhood(
    "stock",
    "CRCL",
    "Circle",
    "Circle Internet Group • Robinhood Token",
    "equity",
    "0x1e264ceEEb59F7425D64362Bf12A5b2648B6e66d",
  ),
  robinhood(
    "stock",
    "COIN",
    "Coinbase",
    "Coinbase • Robinhood Token",
    "equity",
    "0x5540d60F879F5D470bF9Ed7d23FFd59Acc10da0c",
  ),
  robinhood(
    "stock",
    "PLTR",
    "Palantir",
    "Palantir Technologies • Robinhood Token",
    "equity",
    "0xA24710Ab6A5e1ef3a7CF3a0333d8bE2bf22782DC",
  ),
  {
    ...robinhood(
      "stock",
      "TSM",
      "Taiwan Semiconductor",
      "Taiwan Semiconductor Manufacturing • Robinhood Token",
      "equity",
      "0xAF9992b0cA54e014ff1EC7fA77AADE973Dba793e",
    ),
    shortName: "TSMC",
  },
  {
    ...robinhood(
      "stock",
      "AMD",
      "Advanced Micro Devices",
      "AMD • Robinhood Token",
      "equity",
      "0xc8124Db156d8F6C7446C040c503FFEAe82383D1B",
    ),
    // The company's own everyday name, which is also its ticker.
    shortName: "AMD",
  },
  robinhood(
    "stock",
    "INTC",
    "Intel",
    "Intel • Robinhood Token",
    "equity",
    "0x5352F9Bf2f58720f8a8CC4D4eDEE56700Bd3d053",
  ),
  robinhood(
    "stock",
    "BABA",
    "Alibaba",
    "Alibaba • Robinhood Token",
    "equity",
    "0x1BeD0547D76F6424e9A3465b36F6dcDCF798A5cf",
  ),
];

/**
 * Symbol → the listed company's own mark, for the ticker tile's icon where
 * one exists (company-marks.tsx). The single source of truth so the tile,
 * `pnpm listings:verify`'s letter-badge report, and any future consumer
 * agree on the same set. A listing absent here draws the lettered fallback,
 * which is deliberate for GME, MU, SNDK, AMZN, MSFT and TSM (no Simple Icons
 * mark), for COIN, AMD and INTC (wordmarks only, illegible at tile size),
 * for BABA (only the marks of two subsidiaries, Alibaba.com and
 * Alibaba Cloud, not the group's) and for the five funds (no issuer mark
 * that clearly represents the fund itself). Alphabet draws Google's G: the
 * holding company has no mark of its own, and the G is how the share is
 * shown wherever it is quoted.
 */
export const LISTING_MARK_BY_SYMBOL: Readonly<Record<string, CompanyMarkId>> = {
  SPCX: "spacex",
  NVDA: "nvidia",
  MSTR: "microstrategy",
  AAPL: "apple",
  TSLA: "tesla",
  GOOGL: "google",
  META: "meta",
  CRCL: "circle",
  PLTR: "palantir",
};

/** The stocks and ETFs on offer: every token listing that is not cash. */
export const STOCK_LISTINGS: readonly TokenListing[] = TOKEN_LISTINGS.filter(
  (listing) => listing.kind === "stock",
);

/**
 * Where idle dollars sit: the one listing of kind `cash`. A plain swap into
 * SGOV, never a money-market supply; the yield line is Treasury yield.
 */
export const CASH_LISTING: TokenListing = (() => {
  const cash = TOKEN_LISTINGS.filter((listing) => listing.kind === "cash");
  if (cash.length !== 1) {
    throw new Error(`listings: expected exactly one cash listing, got ${cash.length}`);
  }
  return cash[0];
})();

/**
 * A token listing as the SDK's ConfigService needs to see it, so quotes and
 * intent builds pass `isValidOriginalAssetAddress(sonic, address)` instead of
 * throwing `unsupported token_dst` before any request leaves. Sonic-native,
 * so hub asset and vault are the token itself (matches the backend's
 * hub-asset table for every one of these).
 */
/** What a narrow board row calls a listing: its short name where it has one. */
export function rowName(listing: TokenListing): string {
  return listing.shortName ?? listing.name;
}

export function toXToken(listing: TokenListing): XToken {
  return {
    symbol: listing.symbol,
    name: listing.issuerName,
    decimals: listing.decimals,
    address: listing.address,
    chainKey: ChainKeys.SONIC_MAINNET,
    hubAsset: listing.address,
    vault: listing.address,
  };
}

/** A cup from the SDK registry, in listing shape. */
export function vaultListing(vault: LeverageYieldVault): VaultListing {
  return {
    kind: "vault",
    symbol: vault.name,
    name: vault.name,
    address: vault.vault,
    decimals: 18,
    vault,
  };
}

/**
 * Everything on offer: the cups the SDK registry carries, then the token
 * listings. Callers pass `sodax.leverageYield.listVaults()`; this module
 * stays free of the SDK instance so it can be imported anywhere, including
 * the server.
 */
export function listListings(
  vaults: readonly LeverageYieldVault[],
): readonly Listing[] {
  return [...vaults.map(vaultListing), ...TOKEN_LISTINGS];
}

/** Case-insensitive address lookup, since chains and wallets disagree on casing. */
export function findListing(
  listings: readonly Listing[],
  address: string | undefined,
): Listing | undefined {
  if (!address) return undefined;
  const wanted = address.toLowerCase();
  return listings.find((listing) => listing.address.toLowerCase() === wanted);
}

const TOKEN_LISTING_ADDRESSES: ReadonlySet<string> = new Set(
  TOKEN_LISTINGS.map((listing) => listing.address.toLowerCase()),
);

/**
 * Whether an address is one of the pinned token listings. The deposit token
 * picker asks this so a stock is never offered as something to pour IN: a
 * listing is a destination, and selling it is the sell path's job.
 */
export function isTokenListingAddress(address: string): boolean {
  return TOKEN_LISTING_ADDRESSES.has(address.toLowerCase());
}

/**
 * Each listed company's SEC Central Index Key, for its filings on EDGAR
 * (lib/server/news-sources/edgar). Read from sec.gov/files/company_tickers.json
 * on 2026-10-02 and checked against each company's name there. The funds are
 * trusts whose filings say nothing to a holder of the token, so they have none.
 */
export const SEC_CIK_BY_SYMBOL: Readonly<Record<string, number>> = {
  SPCX: 1181412,
  NVDA: 1045810,
  GME: 1326380,
  MSTR: 1050446,
  AAPL: 320193,
  TSLA: 1318605,
  MU: 723125,
  SNDK: 2023554,
  GOOGL: 1652044,
  AMZN: 1018724,
  MSFT: 789019,
  META: 1326801,
  CRCL: 1876042,
  COIN: 1679788,
  PLTR: 1321655,
  TSM: 1046179,
  AMD: 2488,
  INTC: 50863,
  BABA: 1577552,
};
