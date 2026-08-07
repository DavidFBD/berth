"use client";

import { formatUnits } from "viem";
import { useSodaxContext } from "@sodax/dapp-kit";
import { useCopy, useMoney } from "@/components/settings-provider";
import { useEmbeddedHoldings } from "@/hooks/use-embedded-holdings";
import { useUserVaultPosition } from "@/hooks/use-user-vault-position";
import { useUsdPrices } from "@/hooks/use-usd-prices";

/**
 * Everything on the table, in one figure: the teapot's sweep plus every
 * steeping cup. Sits as a quiet line above the pot — token overrides do the
 * theming, so the row needs no per-mode styling, only a per-mode label.
 *
 * Fixed hook slots for the cups, same reasoning as the shelf's
 * useFilledCups: hooks can't loop, the shelf holds at most a handful, and
 * every read here is cache-shared with the cups' own cards.
 */
function useCupsUsd(): number {
  const { sodax } = useSodaxContext();
  const vaults = sodax.leverageYield.listVaults();
  const prices = useUsdPrices();
  const positions = [
    useUserVaultPosition(vaults[0]?.vault),
    useUserVaultPosition(vaults[1]?.vault),
    useUserVaultPosition(vaults[2]?.vault),
    useUserVaultPosition(vaults[3]?.vault),
    useUserVaultPosition(vaults[4]?.vault),
    useUserVaultPosition(vaults[5]?.vault),
  ];
  return vaults.reduce((sum, vault, index) => {
    const underlying = positions[index]?.underlyingValue;
    const price = prices.priceOfHubAsset(vault.asset);
    if (underlying === undefined || price === undefined) return sum;
    return sum + Number(formatUnits(underlying, 18)) * price;
  }, 0);
}

export function TableTotal() {
  const copy = useCopy();
  const money = useMoney();
  const teapot = useEmbeddedHoldings();
  const cupsUsd = useCupsUsd();

  // Wallet guests have no embedded sweep; their cups still count. Nothing
  // priced yet (or genuinely empty) renders nothing — a €0 headline is noise.
  const total = (teapot.totalUsd ?? 0) + cupsUsd;
  if (total <= 0) return null;

  return (
    <div className="mb-3 flex items-baseline justify-between px-1">
      <span className="text-xs text-muted-foreground">{copy.onTheTable}</span>
      <span className="money text-sm font-semibold text-foreground">
        ≈ {money.format(total)}
      </span>
    </div>
  );
}
