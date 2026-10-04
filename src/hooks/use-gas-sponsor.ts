"use client";

import { useCallback } from "react";
import type { SpokeChainKey } from "@sodax/sdk";
import { useAccountSession } from "@/hooks/use-account";
import { useSponsorRefusals } from "@/hooks/use-sponsor-refusals";
import { GAS_SPONSOR_CHAIN_IDS, gasSponsored } from "@/lib/gas-sponsor";

/**
 * Whether Privy pays the fee for an order this person signs on a chain
 * (lib/gas-sponsor gasSponsored): a sponsored chain not refused this
 * session, and the embedded wallet signing. The gas gate, the Max buffer
 * and the "no network fee" lines all read this; everyone else is gated
 * exactly as before.
 */
export function useGasSponsored(): (chainKey: SpokeChainKey | null | undefined) => boolean {
  const { emailSession } = useAccountSession();
  const refusals = useSponsorRefusals();
  return useCallback(
    (chainKey) => gasSponsored(chainKey, emailSession, GAS_SPONSOR_CHAIN_IDS, refusals),
    [emailSession, refusals],
  );
}
