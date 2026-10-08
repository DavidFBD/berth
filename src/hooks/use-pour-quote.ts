"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getSwapQuoteQueryOptions, useSodaxContext } from "@sodax/dapp-kit";
import type { SpokeChainKey } from "@sodax/sdk";
import { minReceivedFor, quoteAmountFor } from "@/lib/pour-amount";
import {
  EMPTY_HOLD,
  SDK_QUOTE_REFRESH_MS,
  freshMinimum,
  judgeFresh,
  quoteClock,
  type FreshAskSlot,
  type PriceCheck,
  holdReduce,
  holdView,
  type HoldState,
  type PairKind,
  type QuoteAnswer,
  type QuoteRefusal,
} from "@/lib/quote-hold";

export type PourQuote = {
  /** Quoted output in the destination token's decimals: live, or held across a blip (lib/quote-hold). */
  quoted: bigint | undefined;
  /** `quoted` less the signing chain's slippage tolerance: what the drawer shows. Never signed as is: see `freshMinOut`. */
  minOut: bigint | undefined;
  /** The solver refuses this pair for a reason other than the amount, more than once in a row. */
  noRoute: boolean;
  /**
   * Why, when `noRoute`: "noPath" (a -4: for a stock, its market is not
   * answering), "unavailable" (proxy, server or rate limit) or "noRoute".
   */
  refusal: Exclude<QuoteRefusal, "tooSmall"> | undefined;
  /** The solver's error number for the refusal shown, when it gave one. */
  refusalCode: number | undefined;
  /** A stock's -4 has lasted past two minutes in a row: the drawer words it as no route. */
  refusalPersistent: boolean;
  /** `quoted` is held: the latest answer was a refusal, or the next one is long in coming. */
  held: boolean;
  /**
   * The solver refused it as too small ("Input amount too low"): the order sits
   * under the solver's own floor although the app's priced it over Berth's.
   * Worded as the smallest order, never as a missing route.
   */
  tooSmall: boolean;
  /**
   * The check before signing (lib/quote-hold judgeFresh): asks for a quote
   * no older than the SDK's own refresh (asked again when the one on hand
   * is older or held; one ask at a time, at most 8 s) and compares its
   * quoted amount, before slippage, with `confirmed`, the minimum the person
   * saw. "ok" carries the confirmed minimum to sign; "moved" means the fresh
   * quote no longer reaches it, and the drawer now shows the new figure; "unavailable" means no fresh answer, and the caller says so
   * itself (a toast): the drawer's refusal line follows the usual two
   * refusal rule, so it may not have changed yet.
   */
  checkPrice: (confirmed: bigint | undefined) => Promise<PriceCheck>;
};

/** dapp-kit's own refresh for a swap quote, read from the SDK so a bump carries it; 3 s today. */
function sdkQuoteRefreshMs(): number {
  try {
    const interval = getSwapQuoteQueryOptions({
      sodax: { swaps: { partnerFee: undefined } } as never,
      payload: undefined,
    }).refetchInterval;
    return typeof interval === "number" && interval > 0 ? interval : SDK_QUOTE_REFRESH_MS;
  } catch {
    return SDK_QUOTE_REFRESH_MS;
  }
}
const QUOTE_MAX_AGE_MS = sdkQuoteRefreshMs();

/**
 * A live quote for one pour, either direction. Callers hand over the PRE-FEE
 * build amount and it goes to the quote as is: `sodax.swaps.getQuote` takes
 * the partner fee off before asking the solver, the same fee the intent takes
 * on chain, so `quoted` is the output of what is actually swapped
 * (lib/pour-amount swapInputFor). Deducting it here too would take it twice.
 * The slippage floor and the Result unwrapping also happen in here, so no
 * caller can build against an unquoted floor.
 *
 * Same call, same refresh as dapp-kit's useQuote, with one difference: each
 * answer folds into a small state (lib/quote-hold) so a flapping solver does
 * not flicker the drawer, and a refusal says what it is.
 */
export function usePourQuote(args: {
  enabled: boolean;
  src: { address: string; chainKey: SpokeChainKey } | null;
  dst: { address: string; chainKey: SpokeChainKey } | null;
  buildAmount: bigint | undefined;
  /**
   * The chain whose wallet signs the order: it sets the slippage tolerance
   * (wider for a slow source, lib/pour-amount slippagePctFor). For a buy the
   * paying chain; for a sell the chain that signs the hub wallet's message.
   */
  signingChainKey: SpokeChainKey;
  /** A stock pair reads a -4 as its market not answering; anything else as no route. */
  pairKind: PairKind;
}): PourQuote {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();
  const quoteAmount = quoteAmountFor(args.buildAmount);

  const payload =
    args.enabled && args.src && args.dst && quoteAmount
      ? {
          token_src: args.src.address,
          token_src_blockchain_id: args.src.chainKey,
          token_dst: args.dst.address,
          token_dst_blockchain_id: args.dst.chainKey,
          amount: quoteAmount,
          quote_type: "exact_input" as const,
        }
      : undefined;
  const sdkOptions = getSwapQuoteQueryOptions({ sodax, payload });
  // Our own key beside dapp-kit's: the data here is the folded state, not the SDK's Result.
  const queryKey = ["berth", "pour-quote", ...sdkOptions.queryKey];
  const key = payload ? JSON.stringify(sdkOptions.queryKey.slice(2)) : null;
  const queryKeyText = JSON.stringify(queryKey);

  const query = useQuery({
    queryKey,
    enabled: !!payload,
    refetchInterval: sdkOptions.refetchInterval,
    retry: false,
    queryFn: async (): Promise<HoldState> => {
      const prev = queryClient.getQueryData<HoldState>(queryKey) ?? EMPTY_HOLD;
      if (!payload || key === null) return prev;
      let answer: QuoteAnswer;
      try {
        const result = await sodax.swaps.getQuote(payload);
        answer = result.ok
          ? { ok: true, quoted: result.value.quoted_amount, at: quoteClock() }
          : { ok: false, error: result.error, at: quoteClock() };
      } catch (error) {
        answer = { ok: false, error, at: quoteClock(), thrown: true };
      }
      return holdReduce(prev, key, answer);
    },
  });

  const state = query.data ?? EMPTY_HOLD;
  // A one second clock while a quote is on screen or refused, so a hanging
  // request marks the quote held and ends it, and a long -4 turns persistent.
  const [tick, setTick] = useState(0);
  const watching = key !== null && (state.good !== undefined || state.failures > 0);
  useEffect(() => {
    if (!watching) return;
    const timer = setInterval(() => setTick(quoteClock()), 1_000);
    return () => clearInterval(timer);
  }, [watching]);
  const view = holdView(state, key, Math.max(tick, state.lastAt ?? 0), QUOTE_MAX_AGE_MS);
  const refetch = query.refetch;
  const slot = useRef<FreshAskSlot["current"]>(null);

  const checkPrice = async (confirmed: bigint | undefined): Promise<PriceCheck> => {
    const fresh = await freshMinimum({
      key,
      read: () => queryClient.getQueryData<HoldState>(JSON.parse(queryKeyText)) ?? EMPTY_HOLD,
      // A re-tap or the interval's own fetch is joined, never cancelled.
      refetch: async () => (await refetch({ cancelRefetch: false })).data,
      // The quoted amount itself, before slippage: judgeFresh compares it with the confirmed minimum.
      toMin: (quoted) => quoted,
      slot,
      maxAgeMs: QUOTE_MAX_AGE_MS,
    });
    return judgeFresh(confirmed, fresh);
  };

  const refusal = view.refusal === "tooSmall" ? undefined : view.refusal;
  return {
    quoted: view.quoted,
    minOut: minReceivedFor(view.quoted, args.signingChainKey),
    noRoute: refusal !== undefined,
    refusal,
    refusalCode: refusal ? view.code : undefined,
    refusalPersistent: refusal !== undefined && view.persistent,
    held: view.held,
    tooSmall: view.refusal === "tooSmall",
    checkPrice,
  };
}
