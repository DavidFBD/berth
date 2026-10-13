"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import { useCancelLimitOrder, useSodaxContext } from "@sodax/dapp-kit";
import {
  ChainKeys,
  EvmSolverService,
  HUB_CHAIN_KEY,
  encodeContractCalls,
  getChainKeyFromRelayChainId,
  getIntentRelayChainId,
  relayTxAndWaitPacket,
  type GetWalletProviderType,
  type Intent,
  type SpokeChainKey,
} from "@sodax/sdk";
import type { LimitOrdersResponse } from "@/app/api/limit-orders/route";
import type { LimitOrderView } from "@/lib/server/limit-orders";
import { HOME_CHAIN } from "@/lib/account";
import { sdkAddress } from "@/lib/chains";
import { COPY } from "@/lib/copy";
import { TOKEN_LISTINGS } from "@/lib/listings";
import { isWaiting } from "@/lib/limit-orders";
import { addPending, readPending, removePending, type PendingLimit } from "@/lib/limit-pending";
import { useAccountHeaders, useAwardPour } from "@/hooks/use-profile";
import { usePrivyEmbeddedWallet } from "@/hooks/use-privy-evm-wallet";
import { LISTINGS_QUERY_KEY } from "@/hooks/use-hub-holdings";
import { useGasPreflight } from "@/hooks/use-gas-gate";

/**
 * Limit orders on the page (lib/server/limit-orders, /api/limit-orders):
 * whether the switch is on for this account, the orders that wait, a
 * record call for a freshly placed one, and cancel.
 *
 * Asked only in an email session: the switch is a list of accounts, and a
 * wallet-only browser must never be asked for a signature by a feature it
 * cannot see. While an order waits (or one placed here is not saved yet)
 * the list polls every half minute, and only while the tab is visible;
 * otherwise it is asked on mount, on focus, and after a place or cancel.
 * The evening cron catches what happens while the page is closed.
 */

export const LIMIT_ORDERS_QUERY_KEY = ["limit-orders"] as const;
const POLL_MS = 30_000;
// Stable reference for the no-data case (signed out, or query disabled): a
// fresh `[]` literal there would change identity every render, and two
// downstream effects (useAnnounceClosings, usePendingLimits) depend on this
// array, so a fresh one each time reruns them forever (Maximum update depth
// exceeded) even while genuinely idle.
const EMPTY_ORDERS: readonly LimitOrderView[] = [];

export type { LimitOrderView };

async function post<T>(headers: Record<string, string>, body: Record<string, unknown>): Promise<T | null> {
  const response = await fetch("/api/limit-orders", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  if (response.status === 404) return null;
  if (!response.ok) return null;
  return response.json() as Promise<T>;
}

export function useLimitOrders({ poll = true }: { poll?: boolean } = {}) {
  const privy = usePrivyEmbeddedWallet();
  const { key, headers } = useAccountHeaders();
  const enabled = privy.authenticated && key !== null;
  const query = useQuery({
    queryKey: [...LIMIT_ORDERS_QUERY_KEY, key],
    enabled,
    // Someone the switch leaves off is asked once per visit, never polled.
    staleTime: (current) => (current.state.data?.enabled === false && current.state.data.orders.length === 0 ? Infinity : 15_000),
    // Polled only while something can change on its own: an order resting
    // or partly filled, or one this browser placed but could not save yet.
    refetchInterval: (current) =>
      poll && ((current.state.data?.orders ?? []).some((order) => isWaiting(order.status)) || readPending().length > 0) ? POLL_MS : false,
    refetchIntervalInBackground: false,
    retry: 1,
    queryFn: async (): Promise<LimitOrdersResponse> => {
      const auth = await headers();
      if (!auth) throw new Error("no session");
      // An order this browser placed but could not save asks for the
      // server's sweep now rather than on its five minute clock.
      const sweep = readPending().length > 0;
      return (await post<LimitOrdersResponse>(auth, { action: "list", ...(sweep && { sweep: true }) })) ?? { enabled: false, orders: [] };
    },
  });
  const orders = query.data?.orders ?? EMPTY_ORDERS;
  return {
    /** The switch. False until the server says otherwise. */
    enabled: query.data?.enabled === true,
    orders,
    waiting: orders.filter((order) => isWaiting(order.status)),
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}

/**
 * Tell the person, once, about an order that closed since the page last
 * asked: a fill gets the toast and the XP a filled order earns (the pour
 * route dedups by intent, so a second call is a no-op), an expiry says
 * where the money went. The server marks each closing as told, so this
 * fires once across tabs and visits.
 */
export function useAnnounceClosings(orders: readonly LimitOrderView[]) {
  const { mutate: awardPour } = useAwardPour();
  const queryClient = useQueryClient();
  const told = useRef(new Set<string>());
  useEffect(() => {
    for (const order of orders) {
      if (!order.justClosed || told.current.has(order.intentTx)) continue;
      told.current.add(order.intentTx);
      const name = TOKEN_LISTINGS.find((listing) => listing.symbol === order.symbol)?.name ?? order.symbol;
      if (order.status === "filled") {
        toast.success(order.direction === "buy" ? COPY.limitFilledBuy(name) : COPY.limitFilledSell(name));
        awardPour({ direction: order.direction === "buy" ? "in" : "out", intentTxHash: order.intentTx, fillTxHash: order.fillTx ?? undefined });
        void queryClient.invalidateQueries({ queryKey: LISTINGS_QUERY_KEY });
      } else if (order.status === "expired") {
        toast(COPY.limitExpiredToast(name), { description: order.direction === "buy" ? COPY.limitRefundBuy : COPY.limitRefundSell });
      }
    }
  }, [orders, awardPour, queryClient]);
}

/** Record a limit order the machine just placed. Fire and forget: the chain holds the order either way. */
export function useRecordLimitOrder() {
  const { headers } = useAccountHeaders();
  const queryClient = useQueryClient();
  return useCallback(
    async (order: {
      intentTxHash: string;
      spokeTxHash: string;
      direction: "buy" | "sell";
      limitPrice: string;
      intentHash?: string;
      srcChain: SpokeChainKey;
    }): Promise<boolean> => {
      // Kept in this browser until the record lands, so a failure here
      // never leaves an order on chain that Berth forgets.
      addPending({ ...order, at: Date.now() });
      // The backend indexes a few seconds behind the hub, and the route
      // reads the intent from its receipt, so one retry covers a slow RPC.
      for (let attempt = 0; attempt < 3; attempt++) {
        const auth = await headers();
        if (!auth) return false;
        const { spokeTxHash, ...body } = order;
        const answer = await post<{ ok: boolean }>(auth, { action: "record", ...body }).catch(() => null);
        if (answer?.ok) {
          removePending(spokeTxHash);
          void queryClient.invalidateQueries({ queryKey: LIMIT_ORDERS_QUERY_KEY });
          return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 3_000 * (attempt + 1)));
      }
      return false;
    },
    [headers, queryClient],
  );
}

type AnyWalletProvider = GetWalletProviderType<SpokeChainKey>;

/**
 * Where a cancel is signed. A buy's intent was created on the chain that
 * paid, and the SDK's cancelLimitOrder signs there. A sell from the
 * account was created BY the hub wallet on Sonic (hubWalletSwap), so its
 * source chain is Sonic and its source address is the hub wallet itself,
 * which no wallet can sign as; it is cancelled the way it was created,
 * with one message from the home chain that the hub wallet executes.
 */
export function cancelRoute(intent: Pick<Intent, "srcChain">): { kind: "spoke"; chainKey: SpokeChainKey } | { kind: "hubWallet"; chainKey: SpokeChainKey } | null {
  if (intent.srcChain === getIntentRelayChainId(ChainKeys.SONIC_MAINNET)) return { kind: "hubWallet", chainKey: HOME_CHAIN };
  try {
    const chainKey = getChainKeyFromRelayChainId(intent.srcChain) as SpokeChainKey;
    return { kind: "spoke", chainKey };
  } catch {
    return null;
  }
}

/** `calm`: nothing went wrong, the person has a step to take first (the gas check); shown as a plain note. */
export type CancelOutcome = { ok: true } | { ok: false; message: string; rejected?: boolean; calm?: boolean };

/**
 * Cancel one waiting order, one signature. The intent is read back from
 * its own hub transaction (the struct must match the chain exactly), the
 * route above picks how it is signed, and the server is told once the
 * cancel has reached the hub. The refund is the contract's: a buy's money
 * returns to the wallet that paid, on its own chain; a sell's shares
 * return to the account.
 */
export function useCancelWaitingOrder() {
  const { sodax } = useSodaxContext();
  const cancelSpoke = useCancelLimitOrder();
  const { headers } = useAccountHeaders();
  const queryClient = useQueryClient();
  const gasPreflight = useGasPreflight();
  return useMutation({
    mutationFn: async ({
      order,
      walletProvider,
      address,
    }: {
      order: LimitOrderView;
      walletProvider: AnyWalletProvider;
      /** The signing wallet's address on the route's chain. */
      address: string;
    }): Promise<CancelOutcome> => {
      const read = await sodax.swaps.getIntent(order.intentTx as `0x${string}`);
      if (!read.ok) return { ok: false, message: COPY.limitCancelFailed };
      const intent = read.value;
      const route = cancelRoute(intent);
      if (!route) return { ok: false, message: COPY.limitCancelFailed };
      // A cancel is one message the person signs and pays for on the
      // route's chain, sized like a sell: the same gas check as every other
      // signature (hooks/use-gas-gate), before the wallet opens. Sponsored
      // and unknown go on.
      const stop = await gasPreflight({ chainKey: route.chainKey, address, amount: 0n, approval: false, order: "sell", purpose: "cancel" });
      if (stop) return { ok: false, message: stop, calm: true };
      let cancelTx = "";

      if (route.kind === "spoke") {
        const done = await cancelSpoke.mutateAsyncSafe({ srcChainKey: route.chainKey, intent, walletProvider });
        if (!done.ok) return failure(done.error);
        cancelTx = String(done.value.srcChainTxHash);
      } else {
        // Only ever for this account's own hub wallet on the home chain.
        const hubWallet = await sodax.hubProvider.getUserHubWalletAddress(sdkAddress(route.chainKey, address), route.chainKey);
        if (hubWallet.toLowerCase() !== intent.creator.toLowerCase()) return { ok: false, message: COPY.limitCancelNotYours };
        const payload = encodeContractCalls([EvmSolverService.encodeCancelIntent(intent, sodax.config.solver.intentsContract)]);
        const sent = await sodax.spoke.sendMessage({
          srcChainKey: route.chainKey,
          srcAddress: sdkAddress(route.chainKey, address),
          dstChainKey: HUB_CHAIN_KEY,
          dstAddress: sdkAddress(HUB_CHAIN_KEY, intent.creator),
          payload,
          raw: false,
          walletProvider,
        } as never);
        if (!sent.ok) return failure(sent.error);
        const txHash = String(sent.value);
        const verified = await sodax.spoke.verifyTxHash({ txHash, chainKey: route.chainKey });
        if (!verified.ok) return failure(verified.error);
        const relayed = await relayTxAndWaitPacket({
          srcTxHash: txHash,
          data: { address: intent.creator, payload },
          chainKey: route.chainKey,
          relayerApiEndpoint: sodax.swaps.relayerApiEndpoint,
          timeout: undefined,
        });
        if (!relayed.ok) return failure(relayed.error);
        cancelTx = txHash;
      }

      const auth = await headers();
      if (auth) await post(auth, { action: "cancelAsked", intentTxHash: order.intentTx, cancelTxHash: cancelTx }).catch(() => null);
      return { ok: true };
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: LIMIT_ORDERS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: LISTINGS_QUERY_KEY });
    },
  });
}

function failure(error: unknown): CancelOutcome {
  const code = (error as { code?: string } | undefined)?.code;
  console.error("[limit-orders] cancel", error);
  if (code === "USER_REJECTED") return { ok: false, message: COPY.limitCancelKept, rejected: true };
  return { ok: false, message: COPY.limitCancelFailed };
}

/**
 * Orders this browser placed and Berth has not saved yet (lib/limit-pending):
 * each one with a hub transaction is recorded again once per page load,
 * and an entry is dropped once the list holds its order. Returns what is
 * still unsaved, for the line that says so.
 */
export function usePendingLimits(orders: readonly LimitOrderView[], enabled: boolean): PendingLimit[] {
  const record = useRecordLimitOrder();
  const tried = useRef(new Set<string>());
  const [pending, setPending] = useState<PendingLimit[]>([]);
  useEffect(() => {
    const listed = new Set(orders.map((order) => order.intentTx.toLowerCase()));
    const placedAt = orders.map((order) => ({ at: Date.parse(order.placedAt), direction: order.direction }));
    const still: PendingLimit[] = [];
    for (const entry of readPending()) {
      const saved = entry.intentTxHash
        ? listed.has(entry.intentTxHash.toLowerCase())
        : // Without a hub transaction the sweep records it; its order is the one placed since.
          placedAt.some((order) => order.direction === entry.direction && order.at >= entry.at - 60_000);
      if (saved) {
        removePending(entry.spokeTxHash);
        continue;
      }
      still.push(entry);
      if (enabled && entry.intentTxHash && !tried.current.has(entry.spokeTxHash)) {
        tried.current.add(entry.spokeTxHash);
        void record({
          intentTxHash: entry.intentTxHash,
          spokeTxHash: entry.spokeTxHash,
          direction: entry.direction,
          limitPrice: entry.limitPrice,
          intentHash: entry.intentHash,
          srcChain: entry.srcChain as SpokeChainKey,
        });
      }
    }
    // Mirrors browser storage into state for the line; storage is the source.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPending(still);
  }, [orders, enabled, record]);
  return pending;
}
