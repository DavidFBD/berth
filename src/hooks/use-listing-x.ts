"use client";

import { useCallback, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ListingXResponse } from "@/app/api/listing-x/route";
import type { XPost } from "@/lib/x-feed";

/**
 * The route fetches the newest posts once per half-hour slot for everyone
 * (lib/feed-refresh), so a poll every quarter hour sees each new slot within
 * fifteen minutes and costs X nothing extra: the fetch happens once per slot
 * however many visitors poll. TanStack's refetch on window focus only fires
 * once the data is stale, so a tab that comes back later asks once on return.
 */
const X_REFETCH_MS = 15 * 60 * 1000;

/**
 * What is being said on X about the listings. Pass a ticker for one
 * listing's own run, nothing for the river across all of them.
 *
 * `refresh` is the column's button: it asks the route for `fresh=1`, which
 * the server honours at most once per five minutes for everyone and
 * otherwise answers from the shared cache.
 */
export function useListingX(symbol?: string): {
  isLoading: boolean;
  /** Any fetch in flight, the first or a background refresh. */
  isFetching: boolean;
  /** A refresh the reader asked for, in flight. */
  isRefreshing: boolean;
  refresh: () => Promise<void>;
  items: XPost[];
  reserve: XPost[];
  curation: ListingXResponse["curation"];
  updatedAt: number | undefined;
} {
  const fresh = useRef(false);
  const query = useQuery({
    queryKey: ["listings", "x", symbol ?? "all"],
    queryFn: async (): Promise<ListingXResponse> => {
      const params = new URLSearchParams();
      if (symbol) params.set("symbol", symbol);
      if (fresh.current) params.set("fresh", "1");
      fresh.current = false;
      const search = params.toString();
      const response = await fetch(search ? `/api/listing-x?${search}` : "/api/listing-x");
      if (!response.ok) return { items: [], reserve: [] };
      const payload = (await response.json()) as ListingXResponse;
      if (payload.reason) console.warn("[listing-x]", payload.reason);
      return payload;
    },
    staleTime: X_REFETCH_MS,
    refetchInterval: X_REFETCH_MS,
  });
  const { refetch } = query;
  const [isRefreshing, setRefreshing] = useState(false);
  const refresh = useCallback(async () => {
    fresh.current = true;
    setRefreshing(true);
    try {
      await refetch({ cancelRefetch: true });
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);
  return {
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isRefreshing,
    refresh,
    items: query.data?.items ?? [],
    reserve: query.data?.reserve ?? [],
    curation: query.data?.curation,
    updatedAt: query.data?.updatedAt,
  };
}
