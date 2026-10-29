import {
  ChainKeys,
  robinhoodSupportedTokens,
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
 * (`GET /v1/swaps/tokens/sonic` lists 85 tokens on 2026-10-29, these
 * forty six among them, each flagged `isRwa`),
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
  /**
   * The same Robinhood token's own contract on Robinhood Chain (chain 4663,
   * SDK key `robinhood`): what a buy delivered there lands as, in the
   * person's own wallet. Equal to ROBINHOOD_CHAIN_ADDRESS_BY_SYMBOL in
   * lib/market-ids, which a test holds it to. Absent only if the SDK's
   * robinhood spoke stops carrying the token; nothing may then deliver it
   * there.
   */
  rhAddress?: Address;
  /**
   * That token's hub asset on Sonic, as the SDK's robinhood spoke names it:
   * what an intent delivering to Robinhood Chain carries as its output on
   * the hub. Distinct from `address` (the listing on Sonic, the spoke
   * entry's `vault`).
   */
  rhHubAsset?: Address;
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

type RobinhoodTokenEntry = {
  symbol: string;
  isRwa?: boolean;
  name: string;
  decimals: number;
  address: string;
  chainKey: string;
  hubAsset: string;
  vault: string;
};

/**
 * Robinhood Chain tokens the live backend serves (`GET
 * /v1/swaps/tokens/robinhood`) but @sodax/sdk 2.2.0-rc.8's built-in
 * `robinhoodSupportedTokens` does not carry yet: the twenty two of the third
 * shelf. This table bridges until the SDK ships them, in the SDK's own entry
 * shape, keyed by symbol. `pnpm listings:verify` diffs it against the live
 * list (address, hubAsset, vault, decimals, symbol) and fails on drift, and
 * reports any entry the SDK now carries too, so the pin can be dropped.
 */
export const PINNED_ROBINHOOD_TOKENS: Readonly<Record<string, RobinhoodTokenEntry>> = {
  AMC: { symbol: "AMC", isRwa: true, name: "AMC Entertainment", decimals: 18, address: "0x05a3d1Cd21d0C88145E82600E62e7E496e0F222B", chainKey: "robinhood", hubAsset: "0x21cb0fab867942b44da9e2ff15dd865fb0d1a79e", vault: "0x8f7357Ec98e6eBAE8Cfb75802AFFc7c9a774dFBd" },
  HIMS: { symbol: "HIMS", isRwa: true, name: "Hims & Hers Health", decimals: 18, address: "0xCceE82fE024c36fA15E1005edE3E9e4787e23D09", chainKey: "robinhood", hubAsset: "0x88422f01ba064aae528af488d3165b89b0e36467", vault: "0xFb31A6c21439C1e3101e0470a9F3299ECB295b93" },
  LLY: { symbol: "LLY", isRwa: true, name: "Eli Lilly", decimals: 18, address: "0x8005d266423c7ea827372c9c864491e5786600ea", chainKey: "robinhood", hubAsset: "0x6ece6a22ea9ded1b146ba9e435bb31709a5e69b4", vault: "0xa6F481B22349DeA3739089e67D32A8A07078bB53" },
  COST: { symbol: "COST", isRwa: true, name: "Costco", decimals: 18, address: "0x4EA005168D7F09a7A0Ba9D1DEf21a479950E44C2", chainKey: "robinhood", hubAsset: "0xd6f93276dec116a3a0226a55266b90a03559adde", vault: "0x6893A6c578f449AA0f748CA6B2A9Fc50Fed91C30" },
  TTWO: { symbol: "TTWO", isRwa: true, name: "Take-Two Interactive Software", decimals: 18, address: "0x5e81213613b6B86EaB4c6c50d718d34359459786", chainKey: "robinhood", hubAsset: "0x125f946c4a7a82f6d1d14b82ae5ec6508a2a19e9", vault: "0xd56534102359A4b69E81Cf6eFa6835EABd116c44" },
  RBLX: { symbol: "RBLX", isRwa: true, name: "Roblox", decimals: 18, address: "0xF0C4BF4C582cb3836e98394b1d4e7B7281101bE8", chainKey: "robinhood", hubAsset: "0x22f63920a0c17f2565d01b88915a6f4281e41a95", vault: "0xC0D7a1f4cE9AaF981502DA15C8EbAEC21F1678Da" },
  IBM: { symbol: "IBM", isRwa: true, name: "IBM", decimals: 18, address: "0x980dcf6766FA79f5Cf0c4AAdb3ab477ff15a9619", chainKey: "robinhood", hubAsset: "0x3602c728c42bcf17d69b8a102e602c8a8fee3062", vault: "0x6cF19BAD00110C5F4f584b11d3ac935794AE1300" },
  MRNA: { symbol: "MRNA", isRwa: true, name: "Moderna", decimals: 18, address: "0x43B07D15cE533bEc5476d70C22a78a1B2B662155", chainKey: "robinhood", hubAsset: "0xda1db915a200f77cc4c7623b57fbe09f707fe7c9", vault: "0xd5fb16C3fAfaCa3032b0d715d00E72e11Dc799B6" },
  LULU: { symbol: "LULU", isRwa: true, name: "Lululemon", decimals: 18, address: "0x4e62068525Ab11FE768e29dfD00ef909B9803016", chainKey: "robinhood", hubAsset: "0x42bc735dd95fca1719ba88682ef87c664a68fc08", vault: "0x44d7BeFa3fF3BE055910d7591aaA12FD6907F0eb" },
  SNAP: { symbol: "SNAP", isRwa: true, name: "Snap", decimals: 18, address: "0xF6589F11Bc40b669e584073F428B05562F568733", chainKey: "robinhood", hubAsset: "0x77b96d73980b6cafe2b698a8c6adcb446de59653", vault: "0x5E0cBeCFAc572F6Ec0C254CAF9DE20D476814C9F" },
  WYFI: { symbol: "WYFI", isRwa: true, name: "WhiteFiber, Inc.", decimals: 18, address: "0x9e7ABD3C9139D14E4c86DcE0e455AAB7A0C2FB3E", chainKey: "robinhood", hubAsset: "0xb78266b11eff88e4b2bbfe653d636fa9d5fab5dd", vault: "0x94b01A709d83A871034B468a720a420abAa61F69" },
  RIVN: { symbol: "RIVN", isRwa: true, name: "Rivian Automotive", decimals: 18, address: "0xB1BF26c1D20ff267A4f93550d1E0d06ac40a114B", chainKey: "robinhood", hubAsset: "0x39f3b4c27d01db634315801a9263b50dcb9fe927", vault: "0xd37e433ACd08911904Ce3368482E67D569811faC" },
  NFLX: { symbol: "NFLX", isRwa: true, name: "Netflix", decimals: 18, address: "0xE0444EF8BF4eD74f74FD73686e2ddF4C1c5591E8", chainKey: "robinhood", hubAsset: "0xbab4c41f3829dbd17c2e3cbd9b5fb11adbd487aa", vault: "0xc866d70B8a4BAf9a200Fbe9b9db802A0dA32330A" },
  BULL: { symbol: "BULL", isRwa: true, name: "Webull", decimals: 18, address: "0xceF9027c7d6985b85f0BA431125073529A947A68", chainKey: "robinhood", hubAsset: "0xbf7a5f902583144beb36d666fd7704b27d22c7c6", vault: "0xd01969b6effb9c9AAE68F1B5a8505d5738dc29A3" },
  QUBT: { symbol: "QUBT", isRwa: true, name: "Quantum Computing", decimals: 18, address: "0x59818904ab4cE163b3cE4FfB64f2D6Ca02c434B4", chainKey: "robinhood", hubAsset: "0x5e9f6b86b806c1602429bf9362b3eec8aa4f9235", vault: "0x2A6B3ABB63f3b5f002B7683f4eb32f68e3e4103E" },
  NET: { symbol: "NET", isRwa: true, name: "Cloudflare, Inc. Class A common stock", decimals: 18, address: "0x116F00968269B7bfbaD4109cE591d6E74c0601d4", chainKey: "robinhood", hubAsset: "0xcc519c76fda41c3894021cd411d7df141a5c94e1", vault: "0x4658eD29E62701242695a7aF0B534De56956432B" },
  SKHY: { symbol: "SKHY", isRwa: true, name: "SK hynix Inc. American Depositary Shares", decimals: 18, address: "0x84CAb63bc87912E71ad199ff14A0bA45de68FeF8", chainKey: "robinhood", hubAsset: "0x04e561fb6e22b5e6bf2f4c5134afb3dad2265aa0", vault: "0x72E4ad33c018016ee983c8d43C1F739Be1043c54" },
  JNJ: { symbol: "JNJ", isRwa: true, name: "Johnson & Johnson", decimals: 18, address: "0x03DfbBE0AC4E7bCDaFd08eD41A400326B77D8c80", chainKey: "robinhood", hubAsset: "0x42f1912c483e1974ca7601e4e02164e0dfb57ceb", vault: "0x34107FD696CCeFb833256C028c670aC95A4612A5" },
  UPS: { symbol: "UPS", isRwa: true, name: "UPS", decimals: 18, address: "0xf23250dac154D05Bb671CB0d0eBEf3c635c79CE2", chainKey: "robinhood", hubAsset: "0xdb3394a4b4c8d1dd145945eb706624e307919051", vault: "0x17b78F0626c85591D14E4DEFfe1AA14cb86d1A3D" },
  DJT: { symbol: "DJT", isRwa: true, name: "Trump Media & Technology Group", decimals: 18, address: "0x1D11f0496982706C5e14A514D4E79F2e6BdE4516", chainKey: "robinhood", hubAsset: "0x2027aa4839be98f9021c1608754cd793833e24ea", vault: "0xeeb7355B245A50f7a91CFc7adbcE008E6c548960" },
  RDDT: { symbol: "RDDT", isRwa: true, name: "Reddit", decimals: 18, address: "0x05b37Fb53A299a1b874A619e1c4C404D52C36F4C", chainKey: "robinhood", hubAsset: "0xec85b1ac463f8987c72d13dd3df4e4dc2f263dcf", vault: "0x9106D29aee2bB2218ecb913aC2fAca242f315c9b" },
  GLD: { symbol: "GLD", isRwa: true, name: "SPDR Gold Trust", decimals: 18, address: "0xC9a981FEE1F9DEc688bb123ccDeCc63D0deBFC4e", chainKey: "robinhood", hubAsset: "0xe72fa58dc1ab501d530fbc98de2973f9cfaf37bc", vault: "0x308f76Fc48196afb8C953f22d37d072eF3ceE0B8" },
};

/**
 * What the SDK ships, with the pin under it: an SDK entry for the same
 * symbol always wins, so a later SDK bump takes over silently and correctly.
 * Spread into the SDK config's robinhood tables (lib/sodax-config) so every
 * Sodax instance resolves the same tokens.
 */
export const ROBINHOOD_SPOKE_TABLE: Readonly<Record<string, RobinhoodTokenEntry>> = {
  ...PINNED_ROBINHOOD_TOKENS,
  ...(robinhoodSupportedTokens as unknown as Record<string, RobinhoodTokenEntry>),
};

/**
 * The robinhood spoke entry for a ticker (the SDK's, else the pin above),
 * read here rather than from lib/market-ids so this module keeps no
 * local imports: `pnpm listings:verify` loads it straight into Node. The
 * listings test holds every address to the pinned table, and the entry's
 * `vault` to the listing's own Sonic address.
 */
const ROBINHOOD_SPOKE_TOKENS = ROBINHOOD_SPOKE_TABLE as Readonly<
  Record<string, { address: string; hubAsset: string } | undefined>
>;

const robinhood = (
  kind: TokenListing["kind"],
  symbol: string,
  name: string,
  issuerName: string,
  category: StockCategory,
  address: Address,
): TokenListing => {
  const spoke = ROBINHOOD_SPOKE_TOKENS[symbol];
  return {
    kind,
    symbol,
    name,
    issuerName,
    category,
    address,
    decimals: 18,
    wrapper: "robinhood",
    ...(spoke ? { rhAddress: spoke.address as Address, rhHubAsset: spoke.hubAsset as Address } : {}),
  };
};

/**
 * The Robinhood tokens the solver trades on Sonic, in the order the backend
 * lists them: thirteen as of 2026-09-16, twenty four as of 2026-09-30, forty
 * six as of 2026-10-29. Forty five are stocks and ETFs; SGOV is cash. Addresses are EIP-55 as
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
  // The third shelf, pinned 2026-10-29: twenty two more, the rest of what the
  // backend serves on Sonic as Robinhood tokens (forty six in all), each read
  // from `/v1/swaps/tokens/sonic` with its Robinhood Chain twin on `/robinhood`.
  // SDK 2.2.0-rc.8 does not yet carry their robinhood spoke entries, so each
  // takes its `rhAddress` and `rhHubAsset` from PINNED_ROBINHOOD_TOKENS and
  // can be delivered on Robinhood Chain like the rest.
  robinhood(
    "stock",
    "AMC",
    "AMC Entertainment",
    "AMC Entertainment • Robinhood Token",
    "equity",
    "0x8f7357Ec98e6eBAE8Cfb75802AFFc7c9a774dFBd",
  ),
  robinhood(
    "stock",
    "HIMS",
    "Hims & Hers Health",
    "Hims & Hers Health • Robinhood Token",
    "equity",
    "0xFb31A6c21439C1e3101e0470a9F3299ECB295b93",
  ),
  robinhood(
    "stock",
    "LLY",
    "Eli Lilly",
    "Eli Lilly • Robinhood Token",
    "equity",
    "0xa6F481B22349DeA3739089e67D32A8A07078bB53",
  ),
  robinhood(
    "stock",
    "COST",
    "Costco",
    "Costco • Robinhood Token",
    "equity",
    "0x6893A6c578f449AA0f748CA6B2A9Fc50Fed91C30",
  ),
  robinhood(
    "stock",
    "TTWO",
    "Take-Two Interactive",
    "Take-Two Interactive Software • Robinhood Token",
    "equity",
    "0xd56534102359A4b69E81Cf6eFa6835EABd116c44",
  ),
  robinhood(
    "stock",
    "RBLX",
    "Roblox",
    "Roblox • Robinhood Token",
    "equity",
    "0xC0D7a1f4cE9AaF981502DA15C8EbAEC21F1678Da",
  ),
  {
    ...robinhood(
      "stock",
      "IBM",
      "International Business Machines",
      "IBM • Robinhood Token",
      "equity",
      "0x6cF19BAD00110C5F4f584b11d3ac935794AE1300",
    ),
    // The company's own everyday name, which is also its ticker.
    shortName: "IBM",
  },
  robinhood(
    "stock",
    "MRNA",
    "Moderna",
    "Moderna • Robinhood Token",
    "equity",
    "0xd5fb16C3fAfaCa3032b0d715d00E72e11Dc799B6",
  ),
  robinhood(
    "stock",
    "LULU",
    "Lululemon",
    "Lululemon • Robinhood Token",
    "equity",
    "0x44d7BeFa3fF3BE055910d7591aaA12FD6907F0eb",
  ),
  robinhood(
    "stock",
    "SNAP",
    "Snap",
    "Snap • Robinhood Token",
    "equity",
    "0x5E0cBeCFAc572F6Ec0C254CAF9DE20D476814C9F",
  ),
  robinhood(
    "stock",
    "WYFI",
    "WhiteFiber",
    "WhiteFiber, Inc. • Robinhood Token",
    "equity",
    "0x94b01A709d83A871034B468a720a420abAa61F69",
  ),
  robinhood(
    "stock",
    "RIVN",
    "Rivian",
    "Rivian Automotive • Robinhood Token",
    "equity",
    "0xd37e433ACd08911904Ce3368482E67D569811faC",
  ),
  robinhood(
    "stock",
    "NFLX",
    "Netflix",
    "Netflix • Robinhood Token",
    "equity",
    "0xc866d70B8a4BAf9a200Fbe9b9db802A0dA32330A",
  ),
  robinhood(
    "stock",
    "BULL",
    "Webull",
    "Webull • Robinhood Token",
    "equity",
    "0xd01969b6effb9c9AAE68F1B5a8505d5738dc29A3",
  ),
  robinhood(
    "stock",
    "QUBT",
    "Quantum Computing Inc",
    "Quantum Computing • Robinhood Token",
    "equity",
    "0x2A6B3ABB63f3b5f002B7683f4eb32f68e3e4103E",
  ),
  robinhood(
    "stock",
    "NET",
    "Cloudflare",
    "Cloudflare, Inc. Class A common stock • Robinhood Token",
    "equity",
    "0x4658eD29E62701242695a7aF0B534De56956432B",
  ),
  robinhood(
    "stock",
    "SKHY",
    "SK hynix",
    "SK hynix Inc. American Depositary Shares • Robinhood Token",
    "equity",
    "0x72E4ad33c018016ee983c8d43C1F739Be1043c54",
  ),
  robinhood(
    "stock",
    "JNJ",
    "Johnson & Johnson",
    "Johnson & Johnson • Robinhood Token",
    "equity",
    "0x34107FD696CCeFb833256C028c670aC95A4612A5",
  ),
  {
    ...robinhood(
      "stock",
      "UPS",
      "United Parcel Service",
      "UPS • Robinhood Token",
      "equity",
      "0x17b78F0626c85591D14E4DEFfe1AA14cb86d1A3D",
    ),
    shortName: "UPS",
  },
  robinhood(
    "stock",
    "DJT",
    "Trump Media",
    "Trump Media & Technology Group • Robinhood Token",
    "equity",
    "0xeeb7355B245A50f7a91CFc7adbcE008E6c548960",
  ),
  robinhood(
    "stock",
    "RDDT",
    "Reddit",
    "Reddit • Robinhood Token",
    "equity",
    "0x9106D29aee2bB2218ecb913aC2fAca242f315c9b",
  ),
  robinhood(
    "stock",
    "GLD",
    "Gold Trust",
    "SPDR Gold Trust • Robinhood Token",
    "etf",
    "0x308f76Fc48196afb8C953f22d37d072eF3ceE0B8",
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
 * Alibaba Cloud, not the group's) and for GLD and the other funds (no issuer mark
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
  NFLX: "netflix",
  RDDT: "reddit",
  SNAP: "snap",
  NET: "cloudflare",
  RBLX: "roblox",
  UPS: "ups",
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
/**
 * Names that are also ordinary words ("a snap decision", "ups and downs",
 * "quantum computing" the field). For these a plain name alone does not
 * name the company: only the forms below do, matched whole. A form written
 * in CAPITALS_ONLY_FORMS ("UPS") is matched in capitals only.
 */
const ORDINARY_WORD_FORMS: Readonly<Record<string, readonly string[]>> = {
  SNAP: ["Snap Inc", "Snapchat"],
  UPS: ["UPS", "United Parcel Service"],
  QUBT: ["Quantum Computing Inc"],
  MSTR: ["Strategy Inc", "MicroStrategy"],
  META: ["Meta Platforms", "Facebook"],
  CRCL: ["Circle Internet", "Circle Internet Group"],
};

export const CAPITALS_ONLY_FORMS: ReadonlySet<string> = new Set(["UPS"]);

/**
 * Every way a person might write a listing's company: its name, its short
 * name and its issuer's name without the wrapper ("Micron Technology"), or,
 * where the name is also an ordinary word, only the forms that are not.
 * The ticker is not among them.
 */
export function listingNameForms(listing: TokenListing): readonly string[] {
  const forms = ORDINARY_WORD_FORMS[listing.symbol];
  if (forms) return forms;
  const names = [listing.name, listing.shortName, listing.issuerName.split(" • ")[0]];
  return [...new Set(names.filter((name): name is string => Boolean(name && name.trim())).map((name) => name.trim()))];
}

/** Whether a listing's plain name is also an ordinary word (see ORDINARY_WORD_FORMS). */
export const hasOrdinaryName = (listing: TokenListing): boolean => listing.symbol in ORDINARY_WORD_FORMS;

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
 * on 2026-10-02 and checked against each company's name there. The funds (GLD among them) are
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
  AMC: 1411579,
  HIMS: 1773751,
  LLY: 59478,
  COST: 909832,
  TTWO: 946581,
  RBLX: 1315098,
  IBM: 51143,
  MRNA: 1682852,
  LULU: 1397187,
  SNAP: 1564408,
  WYFI: 2042022,
  RIVN: 1874178,
  NFLX: 1065280,
  BULL: 1866364,
  QUBT: 1758009,
  NET: 1477333,
  SKHY: 2120882,
  JNJ: 200406,
  UPS: 1090727,
  DJT: 1849635,
  RDDT: 1713445,
};
