"use client";

import { useCallback, useEffect, useState } from "react";
import { createPublicClient, erc20Abi, type Address, type PublicClient } from "viem";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChainKeys, getEvmViemChain } from "@sodax/sdk";
import { invalidateBalances } from "@sodax/dapp-kit";
import { pinnedEvmTransport } from "@/lib/sodax-config";
import {
  ARRIVAL_POLL_MS,
  FUND_USDC_BASE,
  READ_TIMEOUT_MS,
  arrivalView,
  nextLowest,
  stillWatching,
  withTimeout,
  type ArrivalView,
} from "@/lib/funding-handoff";

/** One client for every read of the wait, made on the first. */
let baseClient: PublicClient | null = null;
function baseReader(): PublicClient {
  baseClient ??= createPublicClient({
    chain: getEvmViemChain(ChainKeys.BASE_MAINNET),
    transport: pinnedEvmTransport(ChainKeys.BASE_MAINNET),
  }) as PublicClient;
  return baseClient;
}

/** One USDC balance on Base, read straight from the chain (no oracle, no sweep), failing after READ_TIMEOUT_MS. */
export async function readUsdcOnBase(address: string): Promise<bigint> {
  const balance = await withTimeout(
    baseReader().readContract({
      address: FUND_USDC_BASE,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address as Address],
    }),
    READ_TIMEOUT_MS,
  );
  return BigInt(balance);
}

/** A funding that went through on the provider's side, waiting for its money. */
export type FundingWatch = {
  address: string;
  /** The USDC balance before the payment (lib/funding-handoff readBaseline); undefined when no read answered. */
  baseline: bigint | undefined;
  startedAt: number;
};

export type FundingHandoff = {
  watch: FundingWatch | null;
  view: ArrivalView | null;
  begin: (watch: FundingWatch) => void;
  end: () => void;
};

/**
 * Watches one funding until its money lands on Base (lib/funding-handoff).
 * The balance is read every ARRIVAL_POLL_MS while waiting, and not at all
 * once it arrived or the wait stopped; a minute tick moves the view to its
 * slow and stopped lines even while a read hangs. When the money lands, the
 * Base balances everywhere else are read again, so the buy drawer finds it.
 */
export function useFundingHandoff(): FundingHandoff {
  const [watch, setWatch] = useState<FundingWatch | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const queryClient = useQueryClient();
  // The lowest balance read since the baseline, so a spend meanwhile cannot hide the payment.
  const [lowest, setLowest] = useState<{ startedAt: number; units: bigint } | null>(null);
  const floor = watch && lowest?.startedAt === watch.startedAt ? lowest.units : watch?.baseline;
  const preview = watch ? arrivalView({ baseline: watch.baseline, current: undefined, startedAt: watch.startedAt, now }) : null;
  const balance = useQuery({
    queryKey: ["funding-arrival", watch?.address ?? null, watch?.startedAt ?? 0],
    queryFn: () => readUsdcOnBase(watch!.address),
    enabled: watch !== null && preview !== null && stillWatching(preview),
    refetchInterval: (query) => {
      const current = query.state.data;
      if (!watch) return false;
      const view = arrivalView({ baseline: watch.baseline, lowest: floor, current, startedAt: watch.startedAt, now: Date.now() });
      return stillWatching(view) ? ARRIVAL_POLL_MS : false;
    },
    retry: 1,
    gcTime: 0,
  });
  const view = watch
    ? arrivalView({ baseline: watch.baseline, lowest: floor, current: balance.data, startedAt: watch.startedAt, now })
    : null;
  // A read below the floor lowers it (render-time state adjustment, per house pattern),
  // unless that read is itself the arrival.
  if (watch && floor !== undefined && view?.kind !== "arrived") {
    const next = nextLowest(floor, balance.data);
    if (next !== floor) setLowest({ startedAt: watch.startedAt, units: next });
  }

  // The clock the slow and stopped lines read, while there is a wait to time.
  const waiting = view?.kind === "waiting";
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [waiting]);

  const arrived = view?.kind === "arrived";
  useEffect(() => {
    if (arrived) invalidateBalances(queryClient, ChainKeys.BASE_MAINNET);
  }, [arrived, queryClient]);

  const begin = useCallback((next: FundingWatch) => {
    setNow(Date.now());
    setWatch(next);
  }, []);
  const end = useCallback(() => setWatch(null), []);
  return { watch, view, begin, end };
}
