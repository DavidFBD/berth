/**
 * Display-only names for the SDK's leverage-yield vaults, keyed by the
 * registry `name` (the lsoda* share-token symbol). Berth no longer offers
 * these vaults; the names appear only on the withdraw-only path for
 * positions opened before Berth. Everything on-chain comes from
 * `sodax.leverageYield.listVaults()`.
 */
export type VaultMeta = {
  /** The vault's name on the withdraw-only path. */
  title: string;
};

export const VAULTS_META: Record<string, VaultMeta> = {
  lsodaWEETH: { title: "Leveraged weETH" },
  lsodaWSTETH: { title: "Leveraged wstETH" },
  lsodaJITOSOL: { title: "Leveraged JitoSOL" },
  lsodaSUSDS: { title: "Leveraged sUSDS" },
};

export const FALLBACK_VAULT_META: VaultMeta = { title: "Earlier vault position" };

export function getVaultMeta(name: string): VaultMeta {
  return VAULTS_META[name] ?? FALLBACK_VAULT_META;
}
