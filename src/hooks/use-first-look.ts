"use client";

import { useQuery } from "@tanstack/react-query";
import {
  FIRST_LOOK_SYMBOLS,
  firstBuyProposals,
  lookStateFor,
  type FirstBuyProposals,
  type FirstLookResponse,
  type FirstLookState,
} from "@/lib/first-look";

export const FIRST_LOOK_QUERY_KEY = ["first-look"] as const;

/**
 * How long the first buy waits for the look before it offers the plain list
 * (lib/first-look firstBuyProposals): a slow read never holds the step's one
 * action behind skeletons.
 */
export const FIRST_LOOK_TIMEOUT_MS = 4_000;

/**
 * How often an open first look asks again, and how long an answer counts as
 * fresh: with the edge's ten seconds (app/api/first-look), a headline hidden
 * by moderation leaves Buy within about twenty, even on a card left open.
 */
export const FIRST_LOOK_REFRESH_MS = 10_000;

/** A dev gallery's seeded look (`setQueryDefaults(FIRST_LOOK_QUERY_KEY, { meta: FIRST_LOOK_FIXTURE_META })`): never asked again. */
export const FIRST_LOOK_FIXTURE_META = { fixture: true } as const;

/**
 * The first look (lib/first-look): what may be said about each listing.
 * `also` adds one stock outside the first buy's examples (the first stock
 * card's); the examples alone share one cached answer.
 */
export function useFirstLook(also?: string): {
  lookOf: (symbol: string) => FirstLookState;
  /** The names the first buy offers, only those with news while any has (lib/first-look firstBuyProposals). */
  proposals: FirstBuyProposals;
} {
  const extra = also && !(FIRST_LOOK_SYMBOLS as readonly string[]).includes(also) ? also : undefined;
  const query = useQuery({
    queryKey: extra ? [...FIRST_LOOK_QUERY_KEY, extra] : FIRST_LOOK_QUERY_KEY,
    queryFn: async (): Promise<FirstLookResponse> => {
      const response = await fetch(extra ? `/api/first-look?also=${encodeURIComponent(extra)}` : "/api/first-look", {
        // A timeout is a failed look: no answer, so the plain list and no news line.
        signal: AbortSignal.timeout(FIRST_LOOK_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`first look ${response.status}`);
      return (await response.json()) as FirstLookResponse;
    },
    // Short, and asked again while open, so a headline hidden since leaves Buy within seconds.
    staleTime: (query) => (query.meta?.fixture ? Infinity : FIRST_LOOK_REFRESH_MS),
    refetchInterval: (query) => (query.meta?.fixture ? false : FIRST_LOOK_REFRESH_MS),
    retry: false,
  });
  return {
    lookOf: (symbol) => lookStateFor({ symbol, data: query.data, loading: query.isLoading }),
    proposals: firstBuyProposals({ data: query.data, loading: query.isLoading }),
  };
}
