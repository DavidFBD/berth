"use client";

import { useQuery } from "@tanstack/react-query";
import type { MostBoughtResponse } from "@/lib/social-proof";

/** The answer changes once a week; an hour is plenty. */
const MOST_BOUGHT_REFETCH_MS = 60 * 60 * 1000;

export const MOST_BOUGHT_QUERY_KEY = ["listings", "most-bought"] as const;

/**
 * Most bought on Berth (app/api/most-bought): listings by how many people
 * bought them in the last published week, and that week's Monday. Empty
 * before the first week is published, while a week was too quiet to say
 * anything (lib/social-proof thresholds), and on any failure.
 */
export function useMostBought(): MostBoughtResponse {
  const query = useQuery({
    queryKey: MOST_BOUGHT_QUERY_KEY,
    queryFn: async (): Promise<MostBoughtResponse> => {
      const response = await fetch("/api/most-bought");
      if (!response.ok) return EMPTY;
      const body = (await response.json()) as MostBoughtResponse;
      return { rows: body.rows ?? [], days: body.days ?? 7, week: body.week };
    },
    staleTime: MOST_BOUGHT_REFETCH_MS,
    refetchInterval: MOST_BOUGHT_REFETCH_MS,
  });
  return query.data ?? EMPTY;
}

const EMPTY: MostBoughtResponse = { rows: [], days: 7 };
