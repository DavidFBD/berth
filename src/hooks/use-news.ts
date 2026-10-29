"use client";

import { useCallback, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DISPLAY_GC_MS } from "@/lib/query-freshness";
import type { NewsColumnResponse } from "@/lib/news-stories";

/** The route is CDN cached for a minute and the store changes a few times a day. */
const NEWS_REFETCH_MS = 5 * 60 * 1000;
/** After a refresh the store took, how often and how long to look for the new news. */
const POLL_EVERY_MS = 4_000;
const POLL_FOR_MS = 60_000;

const EMPTY: NewsColumnResponse = { stories: [], reserve: [], owned: [], read: {}, events: [] };

export const newsQueryKey = (symbol?: string) => ["news", "column", symbol ?? "all"] as const;

export type NewsData = NewsColumnResponse & {
  /** The store could not be read: never a quiet day, an honest "cannot be read". */
  failed?: boolean;
  /** The refresh button started an ingest that has not landed yet. */
  refreshing?: boolean;
};

async function read(symbol: string | undefined, mode?: "fresh" | "poll"): Promise<NewsData> {
  const params = new URLSearchParams();
  if (symbol) params.set("symbol", symbol);
  if (mode) params.set(mode, "1");
  const search = params.toString();
  try {
    const response = await fetch(search ? `/api/news?${search}` : "/api/news");
    if (!response.ok) return { ...EMPTY, failed: true };
    const payload = (await response.json()) as NewsData;
    if (payload.reason) console.warn("[news]", payload.reason);
    return { ...EMPTY, ...payload, failed: payload.reason !== undefined };
  } catch {
    return { ...EMPTY, failed: true };
  }
}

/**
 * The news column's stories (app/api/news). Pass a ticker for one listing's
 * own run. `refresh` is the column's button: when the store takes the
 * slot's one extra ingest, this keeps looking for a few seconds at a time
 * until the new news lands (or a minute passes), so "Updated" moves.
 */
export function useNews(symbol?: string): {
  isLoading: boolean;
  isFetching: boolean;
  isRefreshing: boolean;
  refresh: () => Promise<void>;
  data: NewsData;
} {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: newsQueryKey(symbol),
    queryFn: () => read(symbol),
    staleTime: 60_000,
    gcTime: DISPLAY_GC_MS,
    refetchInterval: NEWS_REFETCH_MS,
  });
  const [isRefreshing, setRefreshing] = useState(false);
  const busy = useRef(false);
  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setRefreshing(true);
    try {
      const before = query.data?.updatedAt;
      let answer = await read(symbol, "fresh");
      client.setQueryData(newsQueryKey(symbol), answer);
      const claimed = answer.refreshing === true;
      const until = Date.now() + POLL_FOR_MS;
      while (claimed && !answer.failed && Date.now() < until) {
        await new Promise((resolve) => setTimeout(resolve, POLL_EVERY_MS));
        answer = await read(symbol, "poll");
        if (answer.updatedAt !== undefined && answer.updatedAt !== before) {
          client.setQueryData(newsQueryKey(symbol), answer);
          break;
        }
      }
    } finally {
      busy.current = false;
      setRefreshing(false);
    }
  }, [client, query.data?.updatedAt, symbol]);
  return { isLoading: query.isLoading, isFetching: query.isFetching, isRefreshing, refresh, data: query.data ?? EMPTY };
}
