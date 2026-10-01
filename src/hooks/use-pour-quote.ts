"use client";

import { useQuote } from "@sodax/dapp-kit";
import type { SpokeChainKey } from "@sodax/sdk";
import { isTooSmallQuoteError } from "@/lib/order-minimum";
import { minReceivedFor, quoteAmountFor } from "@/lib/pour-amount";

export type PourQuote = {
  /** Quoted output in the destination token's decimals. */
  quoted: bigint | undefined;
  /** `quoted` less the signing chain's slippage tolerance: what the build receives and the drawer shows. */
  minOut: bigint | undefined;
  /** The solver answered and can't route this pair. */
  noRoute: boolean;
  /**
   * The solver refused it as too small ("Input amount too low"): the order sits
   * under the solver's own floor although the app's priced it over Berth's.
   * Worded as the smallest order, never as a missing route.
   */
  tooSmall: boolean;
};

/**
 * A live quote for one pour, either direction. Callers hand over the PRE-FEE
 * build amount and it goes to the quote as is: `sodax.swaps.getQuote` takes
 * the partner fee off before asking the solver, the same fee the intent takes
 * on chain, so `quoted` is the output of what is actually swapped
 * (lib/pour-amount swapInputFor). Deducting it here too would take it twice.
 * The slippage floor and the Result unwrapping also happen in here, so no
 * caller can build against an unquoted floor.
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
}): PourQuote {
  const quoteAmount = quoteAmountFor(args.buildAmount);

  const quoteQuery = useQuote({
    params: {
      payload:
        args.enabled && args.src && args.dst && quoteAmount
          ? {
              token_src: args.src.address,
              token_src_blockchain_id: args.src.chainKey,
              token_dst: args.dst.address,
              token_dst_blockchain_id: args.dst.chainKey,
              amount: quoteAmount,
              quote_type: "exact_input",
            }
          : undefined,
    },
    queryOptions: { retry: false },
  });

  const quoted = quoteQuery.data?.ok
    ? quoteQuery.data.value.quoted_amount
    : undefined;
  const failed = quoteQuery.data && !quoteQuery.data.ok ? quoteQuery.data : undefined;
  const tooSmall = failed ? isTooSmallQuoteError(failed.error) : false;
  return {
    quoted,
    minOut: minReceivedFor(quoted, args.signingChainKey),
    noRoute: failed !== undefined && !tooSmall,
    tooSmall,
  };
}
