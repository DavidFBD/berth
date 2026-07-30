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
};

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
};

export function getVaultMeta(name: string): VaultMeta {
  return VAULTS_META[name] ?? FALLBACK_VAULT_META;
}
