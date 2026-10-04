"use client";

import { useQuery } from "@tanstack/react-query";
import type { MostHeldResponse } from "@/lib/most-held";

/** The answer changes once a week; an hour is plenty. */
const MOST_HELD_REFETCH_MS = 60 * 60 * 1000;

export const MOST_HELD_QUERY_KEY = ["listings", "most-held"] as const;

/**
 * Most held on Berth (app/api/most-held): listings by the rounded share of
 * accounts holding them at the last published week's close, and that
 * week's Monday. Empty before the first week is published, while too few
 * accounts hold anything (lib/most-held thresholds), and on any failure.
 */
export function useMostHeld(): MostHeldResponse {
  const query = useQuery({
    queryKey: MOST_HELD_QUERY_KEY,
    queryFn: async (): Promise<MostHeldResponse> => {
      const response = await fetch("/api/most-held");
      if (!response.ok) return EMPTY;
      const body = (await response.json()) as MostHeldResponse;
      return { rows: Array.isArray(body.rows) ? body.rows : [], week: body.week };
    },
    staleTime: MOST_HELD_REFETCH_MS,
    refetchInterval: MOST_HELD_REFETCH_MS,
  });
  return query.data ?? EMPTY;
}

const EMPTY: MostHeldResponse = { rows: [] };
