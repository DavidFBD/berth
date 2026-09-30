"use client";

import { useCallback, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ListingNewsResponse } from "@/app/api/listing-news/route";
import type { NewsItem } from "@/lib/news";

/**
 * The route reads each feed once per quarter-hour slot for everyone
 * (lib/feed-refresh); poll on the same quarter hour.
 */
const NEWS_REFETCH_MS = 15 * 60 * 1000;

/**
 * Headlines about the listings. Pass a ticker for one listing's own run,
 * nothing for the river across all of them. `refresh` is the column's
 * button, as in hooks/use-listing-x.
 */
export function useListingNews(symbol?: string): {
  isLoading: boolean;
  isRefreshing: boolean;
  refresh: () => Promise<void>;
  items: NewsItem[];
  updatedAt: number | undefined;
  /** What Jev read this time, for the headlines' credit. Absent when it read none. */
  judged: ListingNewsResponse["judged"];
} {
  const fresh = useRef(false);
  const query = useQuery({
    queryKey: ["listings", "news", symbol ?? "all"],
    queryFn: async (): Promise<ListingNewsResponse> => {
      const params = new URLSearchParams();
      if (symbol) params.set("symbol", symbol);
      if (fresh.current) params.set("fresh", "1");
      fresh.current = false;
      const search = params.toString();
      const response = await fetch(search ? `/api/listing-news?${search}` : "/api/listing-news");
      if (!response.ok) return { items: [] };
      const payload = (await response.json()) as ListingNewsResponse;
      if (payload.reason) console.warn("[listing-news]", payload.reason);
      return { items: payload.items ?? [], updatedAt: payload.updatedAt, judged: payload.judged };
    },
    staleTime: NEWS_REFETCH_MS,
    refetchInterval: NEWS_REFETCH_MS,
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
    isRefreshing,
    refresh,
    items: query.data?.items ?? [],
    updatedAt: query.data?.updatedAt,
    judged: query.data?.judged,
  };
}
