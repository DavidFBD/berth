"use client";

import { useMemo } from "react";
import { formatUnits } from "viem";
import { useReservesUsdFormat } from "@sodax/dapp-kit";
import type { XToken } from "@sodax/sdk";

export type UsdPrices = {
  /** True while the reserve list (and thus the oracle prices) is in flight. */
  isLoading: boolean;
  /** Oracle USD price for a token, or undefined when it isn't a listed reserve. */
  priceOf: (token: XToken) => number | undefined;
  /** USD value of a raw balance, or undefined when the token has no price. */
  usdValue: (token: XToken, balance: bigint) => number | undefined;
};

/**
 * USD prices from the SODAX money market oracle (Aave-style, on the hub):
 * one `useReservesUsdFormat` query yields `priceInUSD` per reserve. Spoke
 * tokens join through the hub addresses every `XToken` already carries —
 * reserves are keyed by their hub underlying, which for vaulted deposits is
 * the soda vault, so try `vault` first and fall back to `hubAsset`. Tokens
 * that aren't money market reserves simply price as undefined.
 */
export function useUsdPrices(): UsdPrices {
  const reservesQuery = useReservesUsdFormat();

  return useMemo(() => {
    const priceByHubAddress = new Map<string, number>();
    for (const reserve of reservesQuery.data ?? []) {
      const price = Number(reserve.priceInUSD);
      if (Number.isFinite(price) && price > 0) {
        priceByHubAddress.set(reserve.underlyingAsset.toLowerCase(), price);
      }
    }

    const priceOf = (token: XToken): number | undefined =>
      priceByHubAddress.get(token.vault.toLowerCase()) ??
      priceByHubAddress.get(token.hubAsset.toLowerCase());

    return {
      isLoading: reservesQuery.isLoading,
      priceOf,
      usdValue: (token: XToken, balance: bigint): number | undefined => {
        const price = priceOf(token);
        if (price === undefined) return undefined;
        return Number(formatUnits(balance, token.decimals)) * price;
      },
    };
  }, [reservesQuery.data, reservesQuery.isLoading]);
}
