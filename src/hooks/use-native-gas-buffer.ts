"use client";

import { useQuery } from "@tanstack/react-query";
import { createPublicClient, http, parseUnits } from "viem";
import {
  ChainKeys,
  getEvmViemChain,
  isEvmChainKeyType,
  type SpokeChainKey,
  type XToken,
} from "@sodax/sdk";
import { getPinnedRpcUrl } from "@/lib/sodax-config";

/**
 * How much of the NATIVE token to hold back from a "Max" pour so the
 * transaction can still pay its own network fee.
 *
 * This used to be a flat 0.01 native units on every chain, which is wrong by
 * orders of magnitude in both directions because native tokens don't share a
 * unit value: 0.01 BNB is ~$6 and 0.01 ETH on Base is ~$19 (where a pour costs
 * a fraction of a cent), while 0.01 POL is a hundredth of a cent. A user with
 * $6 of BNB got a Max of $0, and with $9 got $3.
 *
 * So price the fee instead of guessing it. On EVM that means the live gas price
 * times a generous limit — the honest number, which currently lands between a
 * tenth of a cent and ~20 cents across our chains. Non-EVM families use a
 * fee-shaped constant or, failing that, a small USD-denominated amount.
 *
 * Note the SDK's own `useEstimateGas` can't serve this: it estimates an
 * already-built transaction (`{tx, chainKey}`), so it needs the very amount
 * Max is trying to compute, it returns gas UNITS rather than a fee on EVM, and
 * its return shape differs per chain family.
 */

/**
 * Upper bound on gas for a cross-chain deposit (transfer + AssetManager call).
 * Deliberately generous: over-estimating costs the user pennies, while
 * under-estimating strands the pour at signing.
 */
const DEPOSIT_GAS_LIMIT = 350_000n;

/** Gas can climb between tapping Max and signing, so leave headroom. */
const GAS_PRICE_SAFETY = 3n;

/**
 * Solana fees are stable and tiny (5k lamports a signature), but a deposit may
 * also need to open an associated token account, which costs ~0.002 SOL of
 * rent. 0.003 SOL (~$0.22) covers both without an RPC round-trip.
 */
const SOLANA_BUFFER_LAMPORTS = 3_000_000n;

/** Bitcoin fees are sat-denominated; UTXO selection needs room for one input. */
const BITCOIN_BUFFER_SATS = 3_000n;

/** Fallback for chain families with no fee model here, in USD. */
const FALLBACK_BUFFER_USD = 0.5;

/** Last-resort native amount when the token has no price either. */
const FALLBACK_BUFFER_FRACTION = 100n; // 1% of balance

const GAS_PRICE_STALE_MS = 30_000;

/**
 * Live gas price for an EVM chain. Cached briefly and shared by query key, so
 * repeated Max taps don't re-hit the RPC.
 */
function useEvmGasPrice(chainKey: SpokeChainKey | undefined, enabled: boolean) {
  const evmChainKey =
    chainKey && isEvmChainKeyType(chainKey) ? chainKey : undefined;

  return useQuery({
    queryKey: ["gasPrice", evmChainKey],
    queryFn: async (): Promise<bigint> => {
      const chain = getEvmViemChain(evmChainKey!);
      const client = createPublicClient({
        chain,
        // Pinned endpoint where we have one; viem's default otherwise.
        transport: http(getPinnedRpcUrl(evmChainKey!)),
      });
      return client.getGasPrice();
    },
    enabled: enabled && !!evmChainKey,
    staleTime: GAS_PRICE_STALE_MS,
    refetchInterval: GAS_PRICE_STALE_MS,
  });
}

export type NativeGasBuffer = {
  /**
   * Native-token units to withhold. `undefined` only while an EVM gas price is
   * still in flight; callers should wait rather than assume zero.
   */
  buffer: bigint | undefined;
  isLoading: boolean;
};

/**
 * Gas headroom for a Max pour of `token` from `chainKey`. Returns a zero buffer
 * for non-native tokens: their fee comes out of the native balance, not out of
 * the amount being poured, so the full token balance is spendable.
 *
 * `priceUsd` powers the non-EVM fallback only.
 */
export function useNativeGasBuffer({
  chainKey,
  token,
  isNative,
  priceUsd,
  balance,
}: {
  chainKey: SpokeChainKey | undefined;
  token: XToken | null;
  isNative: boolean;
  priceUsd: number | undefined;
  balance: bigint | undefined;
}): NativeGasBuffer {
  const isEvm = !!chainKey && isEvmChainKeyType(chainKey);
  const needsGasPrice = isNative && isEvm;
  const gasPriceQuery = useEvmGasPrice(chainKey, needsGasPrice);

  if (!isNative || !token || !chainKey) {
    return { buffer: 0n, isLoading: false };
  }

  if (isEvm) {
    if (gasPriceQuery.data === undefined) {
      // Still loading, or the RPC failed. On failure fall back rather than
      // block the button forever.
      if (gasPriceQuery.isLoading) return { buffer: undefined, isLoading: true };
      return {
        buffer: fallbackBuffer({ token, priceUsd, balance }),
        isLoading: false,
      };
    }
    return {
      buffer: gasPriceQuery.data * DEPOSIT_GAS_LIMIT * GAS_PRICE_SAFETY,
      isLoading: false,
    };
  }

  if (chainKey === ChainKeys.SOLANA_MAINNET) {
    return { buffer: SOLANA_BUFFER_LAMPORTS, isLoading: false };
  }
  if (chainKey === ChainKeys.BITCOIN_MAINNET) {
    return { buffer: BITCOIN_BUFFER_SATS, isLoading: false };
  }

  return {
    buffer: fallbackBuffer({ token, priceUsd, balance }),
    isLoading: false,
  };
}

/** USD-denominated headroom, or 1% of balance when the token has no price. */
function fallbackBuffer({
  token,
  priceUsd,
  balance,
}: {
  token: XToken;
  priceUsd: number | undefined;
  balance: bigint | undefined;
}): bigint {
  if (priceUsd !== undefined && priceUsd > 0) {
    const units = FALLBACK_BUFFER_USD / priceUsd;
    // toFixed avoids exponential notation, which parseUnits rejects.
    return parseUnits(units.toFixed(token.decimals), token.decimals);
  }
  // Proportional and therefore self-limiting: it can never swallow the balance
  // the way a flat native amount could.
  return balance !== undefined ? balance / FALLBACK_BUFFER_FRACTION : 0n;
}
