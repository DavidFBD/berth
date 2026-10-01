"use client";

import { useQuery } from "@tanstack/react-query";
import { FIRST_LOOK_SYMBOLS, lookStateFor, type FirstLookResponse, type FirstLookState } from "@/lib/first-look";

export const FIRST_LOOK_QUERY_KEY = ["first-look"] as const;

/**
 * The first look (lib/first-look): what may be said about each listing.
 * `also` adds one stock outside the first buy's examples (the first stock
 * card's); the examples alone share one cached answer.
 */
export function useFirstLook(also?: string): { lookOf: (symbol: string) => FirstLookState } {
  const extra = also && !(FIRST_LOOK_SYMBOLS as readonly string[]).includes(also) ? also : undefined;
  const query = useQuery({
    queryKey: extra ? [...FIRST_LOOK_QUERY_KEY, extra] : FIRST_LOOK_QUERY_KEY,
    queryFn: async (): Promise<FirstLookResponse> => {
      const response = await fetch(extra ? `/api/first-look?also=${encodeURIComponent(extra)}` : "/api/first-look");
      if (!response.ok) throw new Error(`first look ${response.status}`);
      return (await response.json()) as FirstLookResponse;
    },
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
  return {
    lookOf: (symbol) => lookStateFor({ symbol, data: query.data, loading: query.isLoading }),
  };
}
