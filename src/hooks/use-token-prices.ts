"use client";

import { useQuery } from "@tanstack/react-query";
import type { TokenPricesResponse } from "@/app/api/token-prices/route";

/** What consumers see: `reason` is consumed here, at the single fetch. */
export type TokenPrices = Pick<TokenPricesResponse, "prices" | "fx" | "fxDate">;

/** Refetch a little ahead of the route's 5-minute server cache. */
const TOKEN_PRICES_REFETCH_MS = 4 * 60 * 1000;

/**
 * The whole /api/token-prices payload — market prices for tokens the oracle
 * doesn't list, plus USD→display-currency FX rates — behind one query key, so
 * `useUsdPrices` and `useMoney` share a single fetch per interval and a
 * degraded feed is reported regardless of which consumer is mounted.
 */
export function useTokenPrices() {
  return useQuery({
    queryKey: ["tokenPrices"],
    queryFn: async (): Promise<TokenPrices> => {
      const response = await fetch("/api/token-prices");
      if (!response.ok) return { prices: {} };
      const payload = (await response.json()) as TokenPricesResponse;
      if (payload.reason) {
        console.warn("[token-prices]", payload.reason);
      }
      return { prices: payload.prices ?? {}, fx: payload.fx, fxDate: payload.fxDate };
    },
    staleTime: TOKEN_PRICES_REFETCH_MS,
    refetchInterval: TOKEN_PRICES_REFETCH_MS,
  });
}
