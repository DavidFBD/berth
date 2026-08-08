"use client";

import { formatUnits } from "viem";

import {
  useLeverageYieldEffectiveApr,
  type LeverageYieldVault,
} from "@sodax/dapp-kit";

import { useEarnedYield } from "@/hooks/use-earned-yield";
import { useUserVaultPosition } from "@/hooks/use-user-vault-position";
import { useUsdPrices } from "@/hooks/use-usd-prices";
import { computeCupView, type CupView } from "@/lib/cup-view";
import { getVaultMeta } from "@/lib/vaults-meta";

type EffectiveApr = NonNullable<
  ReturnType<typeof useLeverageYieldEffectiveApr>["data"]
>;

export type CupViewState = CupView & {
  /** True once any chain reports a non-zero share balance. */
  hasTea: boolean;
  /** Raw position value in the underlying asset (18dp), for token-unit headlines. */
  underlyingValue: bigint | undefined;
  /** Full APR read, for the breakdown drawer and the shelf's rate line. */
  apr: EffectiveApr | undefined;
  isAprLoading: boolean;
};

/**
 * One cup, one truth: everything a cup rendering needs — steam, fill, the
 * earned figure and its unit — derived once by lib/cup-view, so the shelf
 * miniature and the opened card can never disagree about the same position.
 * The underlying queries are cache-shared across cups, so a hook per cup
 * costs no extra RPC.
 */
export function useCupView(vault: LeverageYieldVault): CupViewState {
  const meta = getVaultMeta(vault.name);

  const { data: apr, isLoading: isAprLoading } = useLeverageYieldEffectiveApr({
    params: { vault: vault.vault },
  });
  const position = useUserVaultPosition(vault.vault);
  const prices = useUsdPrices();

  const steeping =
    position.underlyingValue !== undefined
      ? Number(formatUnits(position.underlyingValue, 18))
      : 0;

  // The position is denominated in the vault's hub asset (the sodaX wrapper),
  // which is a money market reserve — so the oracle already prices it and the
  // cup can speak dollars. Token units remain the fallback.
  const price = prices.priceOfHubAsset(vault.asset);

  // What this cup has actually made. Not readable on chain — the vault mints
  // shares and forgets their price — so it comes off a locally anchored
  // price-per-share. See hooks/use-earned-yield.
  const earnedPosition = useEarnedYield({
    vault: vault.vault,
    shares: position.shares,
    pricePerShare: position.pricePerShare,
    ownerKey: position.ownerKey,
    ready: position.sharesSettled,
  });
  const earned =
    earnedPosition.earned !== undefined
      ? Number(formatUnits(earnedPosition.earned, 18))
      : undefined;

  const view = computeCupView({
    steeping,
    hasPosition: position.hasPosition,
    assetPrice: price,
    aprRay: apr?.effectiveNetAprRay,
    steamThresholds: meta.steamThresholds,
    earned,
  });

  return {
    ...view,
    hasTea: position.hasPosition,
    underlyingValue: position.underlyingValue,
    apr,
    isAprLoading,
  };
}
