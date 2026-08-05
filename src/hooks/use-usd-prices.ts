"use client";

import { useMemo } from "react";
import { formatUnits } from "viem";
import { useQuery } from "@tanstack/react-query";
import { useReservesUsdFormat } from "@sodax/dapp-kit";
import type { XToken } from "@sodax/sdk";
import { COINGECKO_ID_BY_LOWER_SYMBOL } from "@/lib/coingecko-ids";

export type UsdPrices = {
  /** True while the reserve list (and thus the oracle prices) is in flight. */
  isLoading: boolean;
  /** USD price for a token, or undefined when neither source knows it. */
  priceOf: (token: XToken) => number | undefined;
  /** USD value of a raw balance, or undefined when the token has no price. */
  usdValue: (token: XToken, balance: bigint) => number | undefined;
  /**
   * Oracle USD price keyed by a raw hub address — for holdings that arrive as
   * an address rather than an `XToken`, such as a leverage vault's `asset`
   * (the sodaX wrapper the position is denominated in).
   */
  priceOfHubAsset: (address: string | undefined) => number | undefined;
};

type TokenPricesPayload = {
  prices: Record<string, number>;
  reason?: string;
};

/** Refetch a little ahead of the route's 5-minute server cache. */
const MARKET_PRICE_REFETCH_MS = 4 * 60 * 1000;

/**
 * Market prices for tokens the oracle doesn't list, via our own cached route
 * (the CoinGecko key is server-side). One shared query key means every
 * consumer of `useUsdPrices` reuses a single fetch.
 */
function useMarketPrices() {
  return useQuery({
    queryKey: ["tokenPrices", "coingecko"],
    queryFn: async (): Promise<Record<string, number>> => {
      const response = await fetch("/api/token-prices");
      if (!response.ok) return {};
      const payload = (await response.json()) as TokenPricesPayload;
      if (payload.reason) {
        console.warn("[token-prices]", payload.reason);
      }
      return payload.prices ?? {};
    },
    staleTime: MARKET_PRICE_REFETCH_MS,
    refetchInterval: MARKET_PRICE_REFETCH_MS,
  });
}

/**
 * USD prices from two sources, oracle first.
 *
 * The SODAX money market oracle (Aave-style, on the hub) is authoritative:
 * one `useReservesUsdFormat` query yields `priceInUSD` per reserve, and spoke
 * tokens join through the hub addresses every `XToken` already carries —
 * reserves are keyed by their hub underlying, which for vaulted deposits is
 * the soda vault, so try `vault` first and fall back to `hubAsset`.
 *
 * The oracle only knows its own reserves, though, which leaves about a third
 * of the deposit token list (DAI, LINK, cbBTC, BONK…) with no price at all.
 * Those fall back to CoinGecko, matched by symbol. Anything neither source
 * knows still prices as undefined, which every caller already handles.
 */
export function useUsdPrices(): UsdPrices {
  const reservesQuery = useReservesUsdFormat();
  const marketQuery = useMarketPrices();

  const reserves = reservesQuery.data;
  const marketPrices = marketQuery.data;

  return useMemo(() => {
    const priceByHubAddress = new Map<string, number>();
    for (const reserve of reserves ?? []) {
      const price = Number(reserve.priceInUSD);
      if (Number.isFinite(price) && price > 0) {
        priceByHubAddress.set(reserve.underlyingAsset.toLowerCase(), price);
      }
    }

    // Symbol → price, restricted to symbols we pinned an id for, so an
    // unexpected key in the payload can't masquerade as a price.
    const priceBySymbol = new Map<string, number>();
    for (const [symbol, price] of Object.entries(marketPrices ?? {})) {
      const lower = symbol.toLowerCase();
      if (lower in COINGECKO_ID_BY_LOWER_SYMBOL && price > 0) {
        priceBySymbol.set(lower, price);
      }
    }

    const priceOfHubAsset = (address: string | undefined): number | undefined =>
      address ? priceByHubAddress.get(address.toLowerCase()) : undefined;

    const priceOf = (token: XToken): number | undefined =>
      priceByHubAddress.get(token.vault.toLowerCase()) ??
      priceByHubAddress.get(token.hubAsset.toLowerCase()) ??
      priceBySymbol.get(token.symbol.toLowerCase());

    return {
      // The market query is a gap-filler, not a gate: making the whole app
      // wait on it would stall the shelf for tokens the oracle already prices.
      isLoading: reservesQuery.isLoading,
      priceOf,
      priceOfHubAsset,
      usdValue: (token: XToken, balance: bigint): number | undefined => {
        const price = priceOf(token);
        if (price === undefined) return undefined;
        return Number(formatUnits(balance, token.decimals)) * price;
      },
    };
  }, [reserves, marketPrices, reservesQuery.isLoading]);
}
