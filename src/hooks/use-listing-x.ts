"use client";

import { useQuery } from "@tanstack/react-query";
import type { ListingXResponse } from "@/app/api/listing-x/route";
import type { XPost } from "@/lib/x-feed";

/**
 * The route caches upstream for an hour (lib/server/x-column), so polling
 * harder buys nothing and costs a request per visitor per interval. Polling
 * on the same hour picks up each refreshed cache within the hour. TanStack's
 * default refetch on window focus only fires once the data is stale, so a
 * tab that comes back after more than an hour asks once on return.
 */
const X_REFETCH_MS = 60 * 60 * 1000;

/**
 * What is being said on X about the listings. Pass a ticker for one
 * listing's own run, nothing for the river across all of them.
 */
export function useListingX(symbol?: string): {
  isLoading: boolean;
  items: XPost[];
  reserve: XPost[];
  curation: ListingXResponse["curation"];
} {
  const query = useQuery({
    queryKey: ["listings", "x", symbol ?? "all"],
    queryFn: async (): Promise<ListingXResponse> => {
      const response = await fetch(
        symbol ? `/api/listing-x?symbol=${encodeURIComponent(symbol)}` : "/api/listing-x",
      );
      if (!response.ok) return { items: [], reserve: [] };
      const payload = (await response.json()) as ListingXResponse;
      if (payload.reason) console.warn("[listing-x]", payload.reason);
      return payload;
    },
    staleTime: X_REFETCH_MS,
    refetchInterval: X_REFETCH_MS,
  });
  return {
    isLoading: query.isLoading,
    items: query.data?.items ?? [],
    reserve: query.data?.reserve ?? [],
    curation: query.data?.curation,
  };
}
