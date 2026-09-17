"use client";

import { useCallback, useEffect, useState } from "react";
import { formatUnits } from "viem";
import { useSodaxContext, type LeverageYieldVault } from "@sodax/dapp-kit";

import { Button } from "@/components/ui/button";
import { useCopy, useMoney } from "@/components/settings-provider";
import { useUserVaultPosition } from "@/hooks/use-user-vault-position";
import { useUsdPrices } from "@/hooks/use-usd-prices";
import { formatTokenAmount } from "@/lib/format";
import { getVaultMeta } from "@/lib/vaults-meta";
import { SectionHeading } from "@/components/ui/panel";
import { isDust } from "@/lib/dust";
import { cn } from "@/lib/utils";

/**
 * Earlier leveraged vault positions, withdraw only: Berth no longer offers
 * new vault deposits, so this section exists purely for the accounts that
 * still hold one from before. Every vault gets its own row component (hooks
 * can't run in a loop), each reporting up whether it actually holds
 * anything; the section itself only shows once at least one does, and
 * disappears again once the last position is withdrawn.
 */
export function VaultPositions({
  onWithdraw,
}: {
  onWithdraw: (vault: LeverageYieldVault) => void;
}) {
  const { sodax } = useSodaxContext();
  const copy = useCopy();
  const vaults = sodax.leverageYield.listVaults();

  const [presence, setPresence] = useState<Record<string, boolean>>({});
  const onPresence = useCallback((vaultAddress: string, has: boolean) => {
    setPresence((prev) =>
      prev[vaultAddress] === has ? prev : { ...prev, [vaultAddress]: has },
    );
  }, []);

  const anyPresent = Object.values(presence).some(Boolean);

  return (
    // Rows stay mounted at all times, `hidden` or not, so their position
    // queries keep running and can flip the section open the moment one
    // resolves true — an `anyPresent &&` guard here would never see it.
    <div className={cn(!anyPresent && "hidden")}>
      <SectionHeading title={copy.vaultsTitle} hint={copy.vaultsHint} />
      <div className="flex flex-col gap-1 p-3">
        {vaults.map((vault) => (
          <VaultRow
            key={vault.vault}
            vault={vault}
            onWithdraw={onWithdraw}
            onPresence={onPresence}
          />
        ))}
      </div>
    </div>
  );
}

/** One vault's position, or nothing at all when the account never held one. */
function VaultRow({
  vault,
  onWithdraw,
  onPresence,
}: {
  vault: LeverageYieldVault;
  onWithdraw: (vault: LeverageYieldVault) => void;
  onPresence: (vaultAddress: string, hasPosition: boolean) => void;
}) {
  const position = useUserVaultPosition(vault.vault);
  const prices = useUsdPrices();
  const copy = useCopy();
  const money = useMoney();

  const price = prices.priceOfHubAsset(vault.asset);
  const usdValue =
    price !== undefined && position.underlyingValue !== undefined
      ? Number(formatUnits(position.underlyingValue, 18)) * price
      : undefined;
  // A leftover worth less than a tenth of a cent is not worth a titled
  // section and a Withdraw button that costs more in fees than it returns.
  // Presence, not just the row, so the whole section disappears with it.
  const worthShowing = position.hasPosition && !isDust(usdValue);

  useEffect(() => {
    onPresence(vault.vault, worthShowing);
  }, [vault.vault, worthShowing, onPresence]);

  if (!worthShowing) return null;

  const value =
    usdValue !== undefined
      ? money.format(usdValue)
      : `${formatTokenAmount(position.shares, 18)} shares`;

  return (
    <div className="flex min-h-14 items-center gap-3 rounded-xl px-1 py-2">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-foreground">
          {getVaultMeta(vault.name).title}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {value}
        </span>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onWithdraw(vault)}
      >
        {copy.vaultWithdraw}
      </Button>
    </div>
  );
}
