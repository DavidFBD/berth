"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatUnits } from "viem";
import type { ListingPricesResponse } from "@/app/api/listing-prices/route";
import type { Listing } from "@/lib/listings";

export type ListingPrices = {
  /** True while the first read is in flight. */
  isLoading: boolean;
  /** USD price for a listing, or undefined when the oracle doesn't price it. */
  priceOf: (listing: Listing) => number | undefined;
  /** USD value of a raw balance, or undefined when unpriced. */
  usdValue: (listing: Listing, balance: bigint) => number | undefined;
};

/** The route caches upstream for a minute; poll just behind it. */
const LISTING_PRICES_REFETCH_MS = 60_000;

/**
 * Solver-oracle prices for the token listings, one fetch per interval shared
 * by every consumer. Cups are not priced here: a vault share is valued
 * through `previewRedeem` by the cup hooks, so `priceOf` answers undefined
 * for a vault listing on purpose.
 */
export function useListingPrices(): ListingPrices {
  const query = useQuery({
    queryKey: ["listings", "prices"],
    queryFn: async (): Promise<Record<string, number>> => {
      const response = await fetch("/api/listing-prices");
      if (!response.ok) return {};
      const payload = (await response.json()) as ListingPricesResponse;
      if (payload.reason) console.warn("[listing-prices]", payload.reason);
      return payload.prices ?? {};
    },
    staleTime: LISTING_PRICES_REFETCH_MS,
    refetchInterval: LISTING_PRICES_REFETCH_MS,
  });

  const prices = query.data;
  return useMemo(() => {
    const priceOf = (listing: Listing): number | undefined =>
      listing.kind === "vault"
        ? undefined
        : prices?.[listing.address.toLowerCase()];
    return {
      isLoading: query.isLoading,
      priceOf,
      usdValue: (listing, balance) => {
        const price = priceOf(listing);
        if (price === undefined) return undefined;
        return Number(formatUnits(balance, listing.decimals)) * price;
      },
    };
  }, [prices, query.isLoading]);
}
