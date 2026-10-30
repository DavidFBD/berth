"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { DISPLAY_GC_MS } from "@/lib/query-freshness";
import type {
  ListingPerformance,
  ListingPerformanceResponse,
} from "@/app/api/listing-performance/route";
import type { Listing } from "@/lib/listings";

/** The route caches the series for an hour; poll well behind it. */
const PERFORMANCE_REFETCH_MS = 15 * 60 * 1000;

export type ListingPerformances = {
  isLoading: boolean;
  /** How this listing has moved, or undefined when nothing is known of it. */
  performanceOf: (listing: Listing) => ListingPerformance | undefined;
  /** Days the sparkline actually covers, straight from the route. */
  seriesDays: number;
};

/**
 * Change figures and the daily series for the listings, one fetch per
 * interval shared by every consumer.
 *
 * A vault is not asked about: a cup's worth is its `previewRedeem`, not a
 * market price, so `performanceOf` answers undefined for one on purpose,
 * the same way `useListingPrices` does.
 */
export function useListingPerformance(): ListingPerformances {
  const query = useQuery({
    queryKey: ["listings", "performance"],
    queryFn: async (): Promise<ListingPerformanceResponse> => {
      const empty: ListingPerformanceResponse = {
        performance: {},
        seriesDays: 0,
      };
      const response = await fetch("/api/listing-performance");
      if (!response.ok) return empty;
      const payload = (await response.json()) as ListingPerformanceResponse;
      if (payload.reason) console.warn("[listing-performance]", payload.reason);
      return payload ?? empty;
    },
    staleTime: PERFORMANCE_REFETCH_MS,
    gcTime: DISPLAY_GC_MS,
    refetchInterval: PERFORMANCE_REFETCH_MS,
  });

  const data = query.data;
  return useMemo(
    () => ({
      isLoading: query.isLoading,
      seriesDays: data?.seriesDays ?? 0,
      performanceOf: (listing) =>
        listing.kind === "vault"
          ? undefined
          : data?.performance?.[listing.symbol],
    }),
    [data, query.isLoading],
  );
}
