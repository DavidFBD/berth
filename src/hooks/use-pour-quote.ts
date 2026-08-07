"use client";

import { useQuote } from "@sodax/dapp-kit";
import type { SpokeChainKey } from "@sodax/sdk";
import { minReceivedFor, quoteInputFor } from "@/lib/pour-amount";

export type PourQuote = {
  /** Quoted output in the destination token's decimals. */
  quoted: bigint | undefined;
  /** `quoted` with the app's slippage tolerance applied — what the build receives. */
  minOut: bigint | undefined;
  /** The solver answered and can't route this pair. */
  noRoute: boolean;
};

/**
 * A live quote for one pour, either direction. Callers hand over the PRE-FEE
 * build amount; the post-fee quote input, the slippage floor, and the raw
 * Result unwrapping all happen in here — no caller can accidentally quote the
 * pre-fee amount or build against an unquoted floor.
 */
export function usePourQuote(args: {
  enabled: boolean;
  src: { address: string; chainKey: SpokeChainKey } | null;
  dst: { address: string; chainKey: SpokeChainKey } | null;
  buildAmount: bigint | undefined;
}): PourQuote {
  const quoteAmount = quoteInputFor(args.buildAmount);

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
  return {
    quoted,
    minOut: minReceivedFor(quoted),
    noRoute: quoteQuery.data ? !quoteQuery.data.ok : false,
  };
}
