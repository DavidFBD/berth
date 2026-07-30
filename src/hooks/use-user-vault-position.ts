"use client";

import { useMemo } from "react";

import {
  useLeverageYieldPreviewRedeem,
  useLeverageYieldShareBalances,
  type Address,
  type LeverageYieldShareHolder,
  type SpokeChainKey,
} from "@sodax/dapp-kit";
import { getXChainType, useXAccounts } from "@sodax/wallet-sdk-react";

import { DEPOSIT_SOURCE_CHAINS } from "@/lib/chains";

/** One vault share (18 decimals) — reads the price-per-share via previewRedeem. */
const ONE_SHARE = 10n ** 18n;

/** Non-zero share balance held under one source chain's derived hub wallet. */
export type UserVaultChainShares = {
  chainKey: SpokeChainKey;
  shares: bigint;
};

export type UserVaultPosition = {
  /** Total lsoda* shares across every connected chain (18 decimals). */
  shares: bigint;
  /**
   * Total shares valued in the vault's underlying asset (18 decimals).
   * `undefined` until the price-per-share read resolves.
   */
  underlyingValue: bigint | undefined;
  /** True while any share-balance query is still loading. */
  isLoading: boolean;
  /** True once any chain reports a non-zero share balance. */
  hasPosition: boolean;
  /**
   * Per-chain breakdown (non-zero rows only). The withdraw flow uses these to
   * pick which `srcChainKey` actually holds shares — the same EOA maps to a
   * DIFFERENT hub wallet per chainKey, so rows are not interchangeable.
   */
  sharesByChain: UserVaultChainShares[];
};

/**
 * Aggregated leverage-vault position for the connected user: one share-balance
 * query per source chain whose wallet family is connected, summed to a total
 * and valued in the vault's underlying asset via ERC-4626 `previewRedeem`.
 */
export function useUserVaultPosition(
  vault: Address | undefined,
): UserVaultPosition {
  const xAccounts = useXAccounts();

  // One holder row per source chain whose family has a connected account.
  const nextHolders: LeverageYieldShareHolder[] = DEPOSIT_SOURCE_CHAINS.flatMap(
    (chainKey) => {
      const chainType = getXChainType(chainKey);
      const address = chainType ? xAccounts[chainType]?.address : undefined;
      return address ? [{ chainKey, address }] : [];
    },
  );

  // Stabilize the holders reference (useXAccounts returns a fresh object each
  // render): memoize on the serialized content so the array reference only
  // changes when the connected-account set actually changes, keeping the
  // fanned-out balance queries from churning.
  const holdersKey = JSON.stringify(nextHolders);
  const holders = useMemo(
    () => JSON.parse(holdersKey) as readonly LeverageYieldShareHolder[],
    [holdersKey],
  );

  const balanceQueries = useLeverageYieldShareBalances({
    params: { vault, holders },
  });

  const { data: pricePerShare } = useLeverageYieldPreviewRedeem({
    params: { vault, shares: ONE_SHARE },
  });

  const shares = balanceQueries.reduce(
    (acc, query) => acc + (query.data?.shares ?? 0n),
    0n,
  );

  const sharesByChain: UserVaultChainShares[] = balanceQueries.flatMap(
    (query) =>
      query.data && query.data.shares > 0n
        ? [{ chainKey: query.data.chainKey, shares: query.data.shares }]
        : [],
  );

  return {
    shares,
    underlyingValue:
      pricePerShare !== undefined
        ? (shares * pricePerShare) / ONE_SHARE
        : undefined,
    isLoading: balanceQueries.some((query) => query.isLoading),
    hasPosition: shares > 0n,
    sharesByChain,
  };
}
