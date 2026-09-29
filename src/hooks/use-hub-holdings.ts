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
  /** Every listing, in registry order, zero balances included, summed over every hub wallet read. */
  holdings: HubHolding[];
  /** Only what the account actually holds. */
  held: HubHolding[];
  /**
   * Each hub wallet's own raw balances, in registry order: a sell spends
   * from one hub wallet, never the sum. Empty until the read settles.
   */
  byWallet: { hubWallet: Address; balances: bigint[] }[];
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
 * and the token listings alike) against each hub wallet, in ONE multicall to
 * the SDK's hub client. An account with more than one linked EVM address
 * has a hub wallet per address (hooks/use-hub-account `hubWallets`), and the
 * totals add them all; one address reads exactly as before.
 *
 * Plain ERC-20 balances, which is all a stock or SGOV is. Vault shares are
 * read the same way here (the share token is an ERC-20 too), but valuing
 * them still goes through `previewRedeem`, the cup hooks' job.
 */
export function useHubHoldings(hubWallet: Address | readonly Address[] | undefined): HubHoldings {
  const { sodax } = useSodaxContext();
  // The registry is static per SDK instance; listVaults() is a sync read.
  const listings = useMemo(
    () => listListings(sodax.leverageYield.listVaults()),
    [sodax],
  );
  const wallets: Address[] = hubWallet === undefined ? [] : typeof hubWallet === "string" ? [hubWallet] : [...hubWallet];

  const query = useQuery({
    // One wallet keeps its old key, so its cache and invalidations stay put.
    queryKey: [...LISTINGS_QUERY_KEY, "holdings", ...(wallets.length <= 1 ? [wallets[0]] : [wallets.join(",")])],
    enabled: wallets.length > 0,
    refetchInterval: HOLDINGS_REFETCH_MS,
    queryFn: async (): Promise<bigint[][]> => {
      if (wallets.length === 0) throw new Error("hub wallet required");
      const results = await sodax.hubProvider.publicClient.multicall({
        allowFailure: false,
        contracts: wallets.flatMap((wallet) =>
          listings.map((listing) => ({
            address: listing.address,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [wallet],
          })),
        ),
      });
      // viem can't narrow a mapped contracts array past the ABI's union of
      // return types; balanceOf is uint256, so this is a no-op at runtime.
      const flat = results.map((value) => BigInt(value));
      return wallets.map((_, index) => flat.slice(index * listings.length, (index + 1) * listings.length));
    },
  });

  const perWallet = query.data;
  const holdings: HubHolding[] = listings.map((listing, index) => ({
    listing,
    balance: perWallet ? perWallet.reduce((sum, balances) => sum + (balances[index] ?? 0n), 0n) : 0n,
  }));

  return {
    holdings,
    held: perWallet ? holdings.filter((holding) => holding.balance > 0n) : [],
    byWallet: perWallet ? wallets.map((wallet, index) => ({ hubWallet: wallet, balances: perWallet[index] ?? [] })) : [],
    isLoading: wallets.length > 0 && query.isLoading,
    settled: query.isSuccess,
    error: query.error,
  };
}
