"use client";

import { useSodaxContext, type LeverageYieldVault } from "@sodax/dapp-kit";

import { VaultCard } from "./vault-card";

export function VaultList({
  onDeposit,
  onWithdraw,
  bloomVault,
}: {
  onDeposit: (v: LeverageYieldVault) => void;
  onWithdraw: (v: LeverageYieldVault) => void;
  /** Vault address whose cup should bloom (post-pour celebration). */
  bloomVault?: string | null;
}) {
  const { sodax } = useSodaxContext();
  const vaults = sodax.leverageYield.listVaults();

  if (vaults.length === 0) {
    return (
      <p className="rounded-xl border border-border p-6 text-center text-sm text-muted-foreground">
        No vaults are available right now. Check back soon.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4">
      {vaults.map((vault) => (
        <VaultCard
          key={vault.vault}
          vault={vault}
          onDeposit={onDeposit}
          onWithdraw={onWithdraw}
          bloom={vault.vault === bloomVault}
        />
      ))}
    </div>
  );
}
