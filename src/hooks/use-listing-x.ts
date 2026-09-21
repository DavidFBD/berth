"use client";

import { useQuery } from "@tanstack/react-query";
import type { ListingXResponse } from "@/app/api/listing-x/route";
import type { XPost } from "@/lib/x-feed";

/**
 * The route caches upstream for six hours, so polling harder buys nothing
 * and costs a request per visitor per interval. An hour is enough to pick up
 * a refreshed cache without asking for one.
 */
const X_REFETCH_MS = 60 * 60 * 1000;

/**
 * What is being said on X about the listings. Pass a ticker for one
 * listing's own run, nothing for the river across all of them.
 */
export function useListingX(symbol?: string): {
  isLoading: boolean;
  items: XPost[];
} {
  const query = useQuery({
    queryKey: ["listings", "x", symbol ?? "all"],
    queryFn: async (): Promise<XPost[]> => {
      const response = await fetch(
        symbol ? `/api/listing-x?symbol=${encodeURIComponent(symbol)}` : "/api/listing-x",
      );
      if (!response.ok) return [];
      const payload = (await response.json()) as ListingXResponse;
      if (payload.reason) console.warn("[listing-x]", payload.reason);
      return payload.items ?? [];
    },
    staleTime: X_REFETCH_MS,
    refetchInterval: X_REFETCH_MS,
  });
  return { isLoading: query.isLoading, items: query.data ?? [] };
}
