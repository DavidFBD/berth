"use client";

import { useQuery } from "@tanstack/react-query";
import type { MoveNews, MovesResponse } from "@/app/api/moves/route";

/** The marks change once a day and the posts every six hours; half an hour is plenty. */
const MOVES_REFETCH_MS = 30 * 60 * 1000;

/**
 * Large moves and the one post Jev read as related to each (lib/server/moves),
 * by listing symbol. Empty on a day nothing moved much, which is most days.
 */
export function useMoves(): ReadonlyMap<string, MoveNews> {
  const query = useQuery({
    queryKey: ["listings", "moves"],
    queryFn: async (): Promise<MoveNews[]> => {
      const response = await fetch("/api/moves");
      if (!response.ok) return [];
      return ((await response.json()) as MovesResponse).moves ?? [];
    },
    staleTime: MOVES_REFETCH_MS,
    refetchInterval: MOVES_REFETCH_MS,
  });
  return new Map((query.data ?? []).map((move) => [move.symbol, move]));
}
