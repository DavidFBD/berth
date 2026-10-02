"use client";

import { useQueries, useQueryClient } from "@tanstack/react-query";
import { getXChainType, getXService } from "@sodax/wallet-sdk-react";
import { isEvmChainKeyType, type EvmChainKey, type SpokeChainKey, type XToken } from "@sodax/sdk";
import { getChainName, getNativeGasToken, toBalanceReadToken } from "@/lib/chains";
import { gasNeed, orderGasShort, payTokenGas, withinOrUnknown, type GasStatus } from "@/lib/gas-need";
import { useCopy } from "@/components/settings-provider";
import { feePerGasQueryOptions } from "@/hooks/use-native-gas-buffer";

export type GasGate = {
  /**
   * Whether `token` on `chainKey` can pay for an order, given that chain's
   * native balance (`undefined` while unknown). No approval is counted: the
   * picker reads no allowances, and the pre-sign check adds one only when
   * the allowance it read needs it.
   */
  statusFor: (chainKey: SpokeChainKey, token: XToken, nativeBalance: bigint | undefined) => GasStatus;
  /** The native fee an order on `chainKey` must find at the chain's own price (lib/gas-need gasNeed). */
  needFor: (chainKey: SpokeChainKey, approval: boolean) => bigint | undefined;
};

/** Whether `token` is its chain's native gas token. */
export function isGasToken(chainKey: SpokeChainKey, token: XToken): boolean {
  return getNativeGasToken(chainKey)?.address === token.address;
}

/**
 * Live inputs for lib/gas-need: the fee per gas on every EVM chain in
 * `chains`, shared by query key with the Max buffer. `enabled` keeps a
 * closed picker from polling.
 */
export function useGasGate(chains: readonly SpokeChainKey[], enabled = true): GasGate {
  const evmChains = [...new Set(chains)].filter((key): key is EvmChainKey => isEvmChainKeyType(key));
  const fees = useQueries({
    queries: evmChains.map((key) => feePerGasQueryOptions(key, enabled)),
  });
  const feeOf = (chainKey: SpokeChainKey): bigint | undefined => {
    const index = evmChains.indexOf(chainKey as EvmChainKey);
    return index < 0 ? undefined : fees[index]?.data;
  };
  const needFor = (chainKey: SpokeChainKey, approval: boolean) =>
    gasNeed({ chainKey, feePerGas: feeOf(chainKey), approval });

  return {
    needFor,
    statusFor: (chainKey, token, nativeBalance) =>
      payTokenGas({
        chainKey,
        isNative: isGasToken(chainKey, token),
        nativeBalance,
        need: needFor(chainKey, false),
      }),
  };
}

/**
 * The last check before a wallet opens: a fresh read of the native balance
 * and the fee, and the plain message to stop with when the chain's own
 * price cannot be paid (`null` to go on). The picker already greys such a
 * token; this catches the race, a balance spent or a fee risen since.
 *
 * Unknown never stops an order: a failed or slow read (lib/gas-need PREFLIGHT_TIMEOUT_MS)
 * goes on to the wallet as before, and so does a 0 off EVM, where the SDK
 * answers 0 for a failed read (lib/gas-need trustedNativeBalance).
 */
export function useGasPreflight(): (args: {
  chainKey: SpokeChainKey;
  address: string;
  token?: XToken;
  amount: bigint;
  approval: boolean;
}) => Promise<string | null> {
  const queryClient = useQueryClient();
  const copy = useCopy();
  return async ({ chainKey, address, token, amount, approval }) => {
    const native = getNativeGasToken(chainKey);
    const chainType = getXChainType(chainKey);
    if (!native || !chainType) return null;
    const [nativeBalance, feePerGas] = await Promise.all([
      withinOrUnknown(getXService(chainType).getBalance(address, toBalanceReadToken(native))),
      isEvmChainKeyType(chainKey)
        ? withinOrUnknown(queryClient.fetchQuery(feePerGasQueryOptions(chainKey, true)))
        : Promise.resolve(undefined),
    ]);
    const isNative = !!token && isGasToken(chainKey, token);
    const short = orderGasShort({
      chainKey,
      isNative,
      nativeBalance,
      amount: isNative ? amount : 0n,
      need: gasNeed({ chainKey, feePerGas, approval }),
    });
    return short ? copy.gasNeededToPay(native.symbol, getChainName(chainKey)) : null;
  };
}
