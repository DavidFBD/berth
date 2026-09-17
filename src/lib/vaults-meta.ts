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
};

export const VAULTS_META: Record<string, VaultMeta> = {
  lsodaWEETH: {
    title: "Leveraged weETH",
    underlyingSymbol: "weETH",
    borrowSymbol: "ETH",
    strategy:
      "Loops EtherFi weETH against borrowed ETH to multiply the staking yield.",
  },
  lsodaWSTETH: {
    title: "Leveraged wstETH",
    underlyingSymbol: "wstETH",
    borrowSymbol: "ETH",
    strategy:
      "Loops Lido wstETH against borrowed ETH to multiply the staking yield.",
  },
  lsodaJITOSOL: {
    title: "Leveraged JitoSOL",
    underlyingSymbol: "JitoSOL",
    borrowSymbol: "SOL",
    strategy:
      "Loops Jito staked SOL against borrowed SOL to multiply the staking yield.",
  },
  lsodaSUSDS: {
    title: "Leveraged sUSDS",
    underlyingSymbol: "sUSDS",
    borrowSymbol: "USDS",
    strategy:
      "Loops Sky savings USDS against borrowed USDS to multiply the savings rate.",
  },
};

export const FALLBACK_VAULT_META: VaultMeta = {
  title: "Leverage vault",
  underlyingSymbol: "",
  borrowSymbol: "",
  strategy: "Leveraged staked-yield strategy on the Sonic hub.",
};

export function getVaultMeta(name: string): VaultMeta {
  return VAULTS_META[name] ?? FALLBACK_VAULT_META;
}
