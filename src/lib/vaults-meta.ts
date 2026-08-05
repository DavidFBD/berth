/**
 * Display-only metadata for the SDK's leverage-yield vaults, keyed by the
 * registry `name` (the lsoda* share-token symbol). Everything on-chain —
 * addresses, assets, LSD sources — comes from `sodax.leverageYield.listVaults()`;
 * this file only holds what a UI needs and the registry doesn't carry.
 */
export type VaultMeta = {
  /** Marketing-friendly vault title. */
  title: string;
  /** The user-facing underlying token symbol (what the strategy is long on). */
  underlyingSymbol: string;
  /** Symbol of the borrowed side of the loop. */
  borrowSymbol: string;
  /** One-line strategy explanation for the vault card. */
  strategy: string;
  /** Ecosystem the LSD lives in, for grouping/labeling. */
  ecosystem: "Ethereum" | "Solana";
  /** Tailwind gradient classes for the vault card accent. */
  gradient: string;
  /** Single glyph used as a lightweight icon. */
  glyph: string;
  /** LSTeaTime tea name for the cup (design-system canon). */
  teaName: string;
  /** Cup accent key — matches the --cup-<key> CSS variable family. */
  cupKey: "earlgrey" | "breakfast" | "sencha";
  /** Blend badge label. */
  flavour: string;
  /** Descriptive asset line under the tea name. */
  assetLine: string;
  /**
   * Fallback steam-level thresholds in UNDERLYING token units, used only when
   * the oracle can't price this vault's asset. The real bands are
   * {@link USD_STEAM_BANDS}.
   */
  steamThresholds: [number, number, number];
};

/**
 * The design's canonical heat bands in USD: a cup steams by what it's worth,
 * so a $500 cup of Sencha and a $500 cup of Earl Grey read the same.
 */
export const USD_STEAM_BANDS: [number, number, number] = [50, 500, 5_000];

export const VAULTS_META: Record<string, VaultMeta> = {
  lsodaWEETH: {
    title: "Leveraged weETH",
    underlyingSymbol: "weETH",
    borrowSymbol: "ETH",
    strategy:
      "Loops EtherFi weETH against borrowed ETH to multiply the staking yield.",
    ecosystem: "Ethereum",
    gradient: "from-indigo-500/20 to-violet-500/5",
    glyph: "Ξ",
    teaName: "Earl Grey",
    cupKey: "earlgrey",
    flavour: "ETH flavour",
    assetLine: "EtherFi weETH",
    steamThresholds: [0.02, 0.2, 2],
  },
  lsodaWSTETH: {
    title: "Leveraged wstETH",
    underlyingSymbol: "wstETH",
    borrowSymbol: "ETH",
    strategy:
      "Loops Lido wstETH against borrowed ETH to multiply the staking yield.",
    ecosystem: "Ethereum",
    gradient: "from-sky-500/20 to-cyan-500/5",
    glyph: "Ξ",
    teaName: "English Breakfast",
    cupKey: "breakfast",
    flavour: "ETH flavour",
    assetLine: "Lido wstETH",
    steamThresholds: [0.015, 0.15, 1.5],
  },
  lsodaJITOSOL: {
    title: "Leveraged JitoSOL",
    underlyingSymbol: "JitoSOL",
    borrowSymbol: "SOL",
    strategy:
      "Loops Jito staked SOL against borrowed SOL to multiply the staking yield.",
    ecosystem: "Solana",
    gradient: "from-emerald-500/20 to-teal-500/5",
    glyph: "◎",
    teaName: "Sencha",
    cupKey: "sencha",
    flavour: "SOL flavour",
    assetLine: "Jito JitoSOL",
    steamThresholds: [0.3, 3, 30],
  },
};

export const FALLBACK_VAULT_META: VaultMeta = {
  title: "Leverage vault",
  underlyingSymbol: "",
  borrowSymbol: "",
  strategy: "Leveraged staked-yield strategy on the Sonic hub.",
  ecosystem: "Ethereum",
  gradient: "from-neutral-500/20 to-neutral-500/5",
  glyph: "◈",
  teaName: "House Blend",
  cupKey: "breakfast",
  flavour: "mystery flavour",
  assetLine: "Sonic hub vault",
  steamThresholds: [0.02, 0.2, 2],
};

export function getVaultMeta(name: string): VaultMeta {
  return VAULTS_META[name] ?? FALLBACK_VAULT_META;
}
