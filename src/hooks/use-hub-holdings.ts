"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSodaxContext } from "@sodax/dapp-kit";
import type { Address } from "@sodax/sdk";
import { erc20Abi } from "viem";
import { listListings, type Listing } from "@/lib/listings";

export type HubHolding = {
  listing: Listing;
  /** Raw `balanceOf` for the hub wallet, in the listing's decimals (18). */
  balance: bigint;
};

export type HubHoldings = {
  /** Every listing, in registry order, zero balances included. */
  holdings: HubHolding[];
  /** Only what the account actually holds. */
  held: HubHolding[];
  /** True while the first read is in flight. */
  isLoading: boolean;
  /**
   * True once a read has succeeded: the one state in which `held` is the
   * whole truth. A loading or errored read is unknown, never zero; the
   * earned-yield anchor learned that lesson the hard way (2026-08-08).
   */
  settled: boolean;
  error: Error | null;
};

/**
 * Sixty seconds, like the share balances: the pour machine invalidates
 * `['listings']` the moment a fill lands, so freshness after a buy or sell
 * never waits on this interval, and a holdings list is not a ticker.
 */
const HOLDINGS_REFETCH_MS = 60_000;

/** The query-key root every listing balance hangs off; invalidate this after a fill. */
export const LISTINGS_QUERY_KEY = ["listings"] as const;

/**
 * What the account holds on the hub: one `balanceOf` per listing (the cups
 * and the token listings alike) against the hub wallet, in ONE multicall to
 * the SDK's hub client. Seventeen reads for the price of one request, where
 * the share-balance hook fans out one POST per holder row per cup.
 *
 * Plain ERC-20 balances, which is all a stock or SGOV is. Vault shares are
 * read the same way here (the share token is an ERC-20 too), but valuing
 * them still goes through `previewRedeem`, the cup hooks' job.
 */
export function useHubHoldings(hubWallet: Address | undefined): HubHoldings {
  const { sodax } = useSodaxContext();
  // The registry is static per SDK instance; listVaults() is a sync read.
  const listings = useMemo(
    () => listListings(sodax.leverageYield.listVaults()),
    [sodax],
  );

  const query = useQuery({
    queryKey: [...LISTINGS_QUERY_KEY, "holdings", hubWallet],
    enabled: Boolean(hubWallet),
    refetchInterval: HOLDINGS_REFETCH_MS,
    queryFn: async (): Promise<bigint[]> => {
      if (!hubWallet) throw new Error("hub wallet required");
      const results = await sodax.hubProvider.publicClient.multicall({
        allowFailure: false,
        contracts: listings.map((listing) => ({
          address: listing.address,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [hubWallet],
        })),
      });
      // viem can't narrow a mapped contracts array past the ABI's union of
      // return types; balanceOf is uint256, so this is a no-op at runtime.
      return results.map((value) => BigInt(value));
    },
  });

  const balances = query.data;
  const holdings: HubHolding[] = listings.map((listing, index) => ({
    listing,
    balance: balances?.[index] ?? 0n,
  }));

  return {
    holdings,
    held: balances ? holdings.filter((holding) => holding.balance > 0n) : [],
    isLoading: Boolean(hubWallet) && query.isLoading,
    settled: query.isSuccess,
    error: query.error,
  };
}
