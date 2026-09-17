"use client";

import { useQuery } from "@tanstack/react-query";
import type { TreasuryRateResponse } from "@/app/api/treasury-rate/route";

/** The route caches for six hours; an hour between polls is plenty. */
const TREASURY_RATE_REFETCH_MS = 60 * 60 * 1000;

/**
 * The 3 month Treasury bill rate for the cash line, from the app's own
 * route. `data` is undefined until the first read; `ratePct` inside it is
 * null when the source is down, which the cash line renders as no rate.
 */
export function useTreasuryRate() {
  return useQuery({
    queryKey: ["treasuryRate"],
    queryFn: async (): Promise<Pick<TreasuryRateResponse, "ratePct" | "asOf">> => {
      const response = await fetch("/api/treasury-rate");
      if (!response.ok) return { ratePct: null, asOf: null };
      const payload = (await response.json()) as TreasuryRateResponse;
      if (payload.reason) console.warn("[treasury-rate]", payload.reason);
      return { ratePct: payload.ratePct, asOf: payload.asOf };
    },
    staleTime: TREASURY_RATE_REFETCH_MS,
    refetchInterval: TREASURY_RATE_REFETCH_MS,
  });
}
