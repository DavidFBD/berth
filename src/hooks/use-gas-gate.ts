"use client";

import { useQueries, useQueryClient } from "@tanstack/react-query";
import { getXChainType, getXService, useXService } from "@sodax/wallet-sdk-react";
import { useXBalances } from "@sodax/dapp-kit";
import { isEvmChainKeyType, type EvmChainKey, type SpokeChainKey, type XToken } from "@sodax/sdk";
import { getNativeGasToken, toBalanceReadToken } from "@/lib/chains";
import { gasShortMessage, type GasPurpose } from "@/lib/gas-message";
import {
  amountLeavesNoFee,
  blockingNeed,
  gasToAdd,
  orderGasShort,
  payTokenGas,
  withinOrUnknown,
  warnReserve,
  type GasOrder,
  type GasStatus,
} from "@/lib/gas-need";
import { useCopy } from "@/components/settings-provider";
import { feePerGasQueryOptions } from "@/hooks/use-native-gas-buffer";
import { useGasSponsored } from "@/hooks/use-gas-sponsor";

export type GasGate = {
  /**
   * Whether `token` on `chainKey` can pay for an order, given that chain's
   * native balance (`undefined` while unknown). No approval is counted: the
   * picker reads no allowances, and the pre-sign check adds one only when
   * the allowance it read needs it.
   */
  statusFor: (chainKey: SpokeChainKey, token: XToken, nativeBalance: bigint | undefined) => GasStatus;
  /**
   * The native balance an order on `chainKey` must find: the chain's own
   * price or the wallet floor, whichever is larger (lib/gas-need
   * blockingNeed). A sell reserves less gas than a buy.
   */
  needFor: (chainKey: SpokeChainKey, approval: boolean, order?: GasOrder) => bigint | undefined;
  /**
   * What a wallet attaching 2 gwei would reserve, on chains whose floor is
   * lower (lib/gas-need warnReserve): pass it to floorWarns.
   */
  warnNeedFor: (chainKey: SpokeChainKey, approval: boolean, order?: GasOrder) => bigint | undefined;
  /**
   * Whether Privy pays this person's fee on `chainKey` (hooks/use-gas-sponsor).
   * Pass it on as `sponsored` to orderGasShort and gasToAdd.
   */
  sponsored: (chainKey: SpokeChainKey) => boolean;
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
  const sponsored = useGasSponsored();
  // A sponsored chain costs the person nothing: no fee to read for it.
  const pricedChains = evmChains.filter((key) => !sponsored(key));
  const fees = useQueries({
    queries: pricedChains.map((key) => feePerGasQueryOptions(key, enabled)),
  });
  const feeOf = (chainKey: SpokeChainKey): bigint | undefined => {
    const index = pricedChains.indexOf(chainKey as EvmChainKey);
    return index < 0 ? undefined : fees[index]?.data;
  };
  const needFor = (chainKey: SpokeChainKey, approval: boolean, order: GasOrder = "buy") =>
    blockingNeed({
      chainKey,
      feePerGas: feeOf(chainKey),
      approval,
      sponsored: sponsored(chainKey),
      order,
    });

  const warnNeedFor = (chainKey: SpokeChainKey, approval: boolean, order: GasOrder = "buy") =>
    warnReserve({ chainKey, feePerGas: feeOf(chainKey), approval, sponsored: sponsored(chainKey), order });

  return {
    needFor,
    warnNeedFor,
    sponsored,
    statusFor: (chainKey, token, nativeBalance) =>
      payTokenGas({
        chainKey,
        isNative: isGasToken(chainKey, token),
        nativeBalance,
        need: needFor(chainKey, false),
        sponsored: sponsored(chainKey),
      }),
  };
}

/**
 * The last check before a wallet opens: a fresh read of the native balance
 * and the fee, and the plain message to stop with when the order's fee
 * cannot be paid, at the chain's own price or the wallet floor (lib/gas-need
 * blockingNeed), naming roughly how much to add (`null` to go on). The picker already greys such a
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
  order?: GasOrder;
  purpose?: GasPurpose;
}) => Promise<string | null> {
  const queryClient = useQueryClient();
  const copy = useCopy();
  const sponsored = useGasSponsored();
  return async ({ chainKey, address, token, amount, approval, order = "buy", purpose = "order" }) => {
    // Privy pays: nothing to check. If Privy refuses at send time, the send
    // falls back to an ordinary one (lib/gas-sponsor withGasSponsor), and a
    // wallet with no gas then hears the calm insufficient-funds sentence.
    if (sponsored(chainKey)) return null;
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
    const facts = { chainKey, isNative, nativeBalance, amount: isNative ? amount : 0n };
    const need = blockingNeed({ chainKey, feePerGas, approval, order });
    if (!orderGasShort({ ...facts, need })) return null;
    return gasShortMessage(copy, native, chainKey, gasToAdd({ ...facts, need }), purpose, amountLeavesNoFee({ ...facts, need }));
  };
}



/**
 * Whether the wallet at `address` can pay one signature's fee on
 * `chainKey` right now, read live: the same need as the drawers
 * (blockingNeed), for screens with no drawer of their own, such as the
 * cancel check. `message` is the calm guidance when it cannot; `null`
 * while it can, while anything is unknown, or when Privy pays.
 */
export function useSignGasCheck({
  chainKey,
  address,
  enabled,
  order = "sell",
  purpose = "order",
}: {
  chainKey: SpokeChainKey;
  address: string | undefined;
  enabled: boolean;
  order?: GasOrder;
  purpose?: GasPurpose;
}): string | null {
  const copy = useCopy();
  const gate = useGasGate([chainKey], enabled);
  const native = getNativeGasToken(chainKey);
  const xService = useXService({ xChainType: getXChainType(chainKey) });
  const query = useXBalances({
    params: {
      xService,
      xChainId: chainKey,
      xTokens: native ? [toBalanceReadToken(native)] : [],
      address: enabled && native ? address : undefined,
    },
    queryOptions: { refetchInterval: 30_000, staleTime: 15_000 },
  });
  if (!native || !query.data) return null;
  const facts = {
    chainKey,
    isNative: false,
    nativeBalance: query.data[toBalanceReadToken(native).address] ?? 0n,
    amount: 0n,
    need: gate.needFor(chainKey, false, order),
    sponsored: gate.sponsored(chainKey),
  };
  if (!orderGasShort(facts)) return null;
  return gasShortMessage(copy, native, chainKey, gasToAdd(facts), purpose);
}
