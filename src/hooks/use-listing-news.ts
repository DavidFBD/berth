"use client";

import { useQuery } from "@tanstack/react-query";
import type { ListingNewsResponse } from "@/app/api/listing-news/route";
import type { NewsItem } from "@/lib/news";

/** The route caches upstream for a quarter hour; poll just behind it. */
const NEWS_REFETCH_MS = 15 * 60 * 1000;

/**
 * Headlines about the listings. Pass a ticker for one listing's own run,
 * nothing for the river across all of them.
 */
export function useListingNews(symbol?: string): {
  isLoading: boolean;
  items: NewsItem[];
} {
  const query = useQuery({
    queryKey: ["listings", "news", symbol ?? "all"],
    queryFn: async (): Promise<NewsItem[]> => {
      const response = await fetch(
        symbol ? `/api/listing-news?symbol=${encodeURIComponent(symbol)}` : "/api/listing-news",
      );
      if (!response.ok) return [];
      const payload = (await response.json()) as ListingNewsResponse;
      if (payload.reason) console.warn("[listing-news]", payload.reason);
      return payload.items ?? [];
    },
    staleTime: NEWS_REFETCH_MS,
    refetchInterval: NEWS_REFETCH_MS,
  });
  return { isLoading: query.isLoading, items: query.data ?? [] };
}
