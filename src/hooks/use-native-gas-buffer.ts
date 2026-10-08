"use client";

import { useQuery } from "@tanstack/react-query";
import { createPublicClient, parseUnits } from "viem";
import {
  ChainKeys,
  getEvmViemChain,
  isEvmChainKeyType,
  type EvmChainKey,
  type SpokeChainKey,
  type XToken,
} from "@sodax/sdk";
import { pinnedEvmTransport } from "@/lib/sodax-config";
import { floorNeed } from "@/lib/gas-need";

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
 * So price the fee instead of guessing it. On EVM that means the live fee per
 * gas times a generous limit, floored by what wallets are observed to charge
 * on that chain whatever the chain itself suggests (see WALLET_FEE_FLOOR;
 * pricing alone reads two cents on Base against a real $0.69 fee). Non-EVM
 * families use a fee-shaped constant or, failing that, a small
 * USD-denominated amount.
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

// The wallet-fee floor and the measured deposit gas live in lib/gas-need,
// shared with the gate that greys a pay token whose chain cannot pay its fee.

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
 * The least a Max may withhold on an EVM chain, whatever the RPC reports:
 * exactly the wallet floor the gate refuses below (lib/gas-need floorNeed),
 * so a Max order is never refused by the gate that set it.
 * Exported for the test that pins issue #23's arithmetic.
 */
export function evmFeeFloorBuffer(chainKey: SpokeChainKey): bigint {
  return floorNeed(chainKey, false) ?? 0n;
}

/**
 * Live fee per gas for an EVM chain. `estimateFeesPerGas` rather than
 * `getGasPrice` because the fee a wallet pays is base plus tip, and on an L2
 * the tip is most of it; `getGasPrice` reports only the base fee there.
 * Cached briefly and shared by query key, so repeated Max taps don't re-hit
 * the RPC.
 */
export async function readEvmFeePerGas(chainKey: EvmChainKey): Promise<bigint> {
  const client = createPublicClient({
    chain: getEvmViemChain(chainKey),
    // Pinned endpoint (and its failovers) where we have one; viem's default otherwise.
    transport: pinnedEvmTransport(chainKey),
  });
  try {
    const fees = await client.estimateFeesPerGas();
    if (fees.maxFeePerGas !== undefined) return fees.maxFeePerGas;
  } catch {
    // Pre-1559 chains and RPCs without eth_feeHistory: fall through.
  }
  return client.getGasPrice();
}

/** One query per chain, shared by key with the picker's gate (hooks/use-gas-gate). */
export function feePerGasQueryOptions(chainKey: EvmChainKey | undefined, enabled: boolean) {
  return {
    queryKey: ["feePerGas", chainKey] as const,
    queryFn: () => readEvmFeePerGas(chainKey!),
    enabled: enabled && !!chainKey,
    staleTime: GAS_PRICE_STALE_MS,
    refetchInterval: GAS_PRICE_STALE_MS,
  };
}

function useEvmFeePerGas(chainKey: SpokeChainKey | undefined, enabled: boolean) {
  const evmChainKey =
    chainKey && isEvmChainKeyType(chainKey) ? chainKey : undefined;
  return useQuery(feePerGasQueryOptions(evmChainKey, enabled));
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
  sponsored = false,
}: {
  chainKey: SpokeChainKey | undefined;
  token: XToken | null;
  isNative: boolean;
  priceUsd: number | undefined;
  balance: bigint | undefined;
  /** Privy pays the fee here for this embedded wallet (hooks/use-gas-sponsor): Max may spend it all. */
  sponsored?: boolean;
}): NativeGasBuffer {
  const isEvm = !!chainKey && isEvmChainKeyType(chainKey);
  const needsFeePerGas = isNative && isEvm && !sponsored;
  const feePerGasQuery = useEvmFeePerGas(chainKey, needsFeePerGas);

  if (!isNative || !token || !chainKey || sponsored) {
    return { buffer: 0n, isLoading: false };
  }

  if (isEvm) {
    const floor = evmFeeFloorBuffer(chainKey);
    if (feePerGasQuery.data === undefined) {
      // Still loading, or the RPC failed. On failure fall back rather than
      // block the button forever.
      if (feePerGasQuery.isLoading)
        return { buffer: undefined, isLoading: true };
      const fallback = fallbackBuffer({ token, priceUsd, balance });
      return {
        buffer: fallback > floor ? fallback : floor,
        isLoading: false,
      };
    }
    // Two independent worst cases, whichever is larger: what the chain says
    // this costs with room for gas to climb, and what a wallet may charge no
    // matter what the chain says.
    const estimated =
      feePerGasQuery.data * DEPOSIT_GAS_LIMIT * GAS_PRICE_SAFETY;
    return {
      buffer: estimated > floor ? estimated : floor,
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
