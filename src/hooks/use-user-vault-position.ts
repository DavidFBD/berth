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
import { resolveAccount } from "@/lib/account";
import { useAccountSession } from "@/hooks/use-account";

/** One vault share (18 decimals) — reads the price-per-share via previewRedeem. */
const ONE_SHARE = 10n ** 18n;

/**
 * Every holder row is one `balanceOf` on the Sonic hub, per cup, per tick: an
 * EVM account fans out to twelve source chains, so four cups make 48 reads a
 * tick, and the SDK's hub client neither batches nor multicalls (each read is
 * its own POST to rpc.soniclabs.com). At the hook's 15s default that looked,
 * from outside, like the same call ten times over every few seconds (Paul,
 * 2026-09-16). A minute is plenty: the pour machine invalidates
 * `['leverageYield']` the moment a fill lands, so freshness after a pour never
 * waited on this interval anyway.
 */
const SHARE_BALANCE_REFETCH_MS = 60_000;

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
  /**
   * Underlying assets one whole share redeems for (18 decimals) — the vault's
   * price-per-share, which creeps up as it accrues. `undefined` until read.
   */
  pricePerShare: bigint | undefined;
  /**
   * Stable identity of the holder set these shares were read for: every
   * queried address, lowercased and sorted. Persisted alongside the earned
   * anchor so one browser's ledger is never applied to another user's shares.
   */
  ownerKey: string;
  /** True while any share-balance query is still loading. */
  isLoading: boolean;
  /**
   * True only when EVERY share-balance query has succeeded — the one state
   * in which `shares` is the whole truth. While loading (or with a chain
   * erroring) the sum is partial, and partial readings must never be folded
   * into the earned anchor: a transient zero reads as a full redemption and
   * the refill re-anchors every share at today's price, silently erasing
   * the earned-so-far basis (field-found 2026-08-08).
   */
  sharesSettled: boolean;
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
  const session = useAccountSession();

  // One holder row per source chain whose family has an account, resolved
  // through the one rule in lib/account — the address whose shares are read
  // here is by construction the address that signed the deposit. (The
  // embedded EVM wallet never enters the external wallet store, so anything
  // less than the shared rule made email users' deposits invisible.)
  const nextHolders: LeverageYieldShareHolder[] = DEPOSIT_SOURCE_CHAINS.flatMap(
    (chainKey) => {
      const chainType = getXChainType(chainKey);
      const external = chainType ? xAccounts[chainType]?.address : undefined;
      const { address } = resolveAccount(chainKey, session, external);
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
    queryOptions: { refetchInterval: SHARE_BALANCE_REFETCH_MS },
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

  const ownerKey = holders
    .map((holder) => holder.address.toLowerCase())
    .sort()
    .join("|");

  return {
    shares,
    underlyingValue:
      pricePerShare !== undefined
        ? (shares * pricePerShare) / ONE_SHARE
        : undefined,
    pricePerShare,
    ownerKey,
    isLoading: balanceQueries.some((query) => query.isLoading),
    sharesSettled:
      balanceQueries.length > 0 &&
      balanceQueries.every((query) => query.isSuccess),
    hasPosition: shares > 0n,
    sharesByChain,
  };
}
