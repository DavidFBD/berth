"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSodaxContext } from "@sodax/dapp-kit";
import { ChainKeys } from "@sodax/sdk";
import type { RobinhoodRun } from "@/hooks/use-vault-action";
import { arrivalPollMs, arrivalState, type ArrivalState } from "@/lib/robinhood-arrival";
import { readRobinhoodBalances, robinhoodClient } from "@/lib/robinhood-chain";

/** How long the relay's own record is waited for, the SDK's default; then the screen says it is slow. */
const PACKET_WAIT_MS = 120_000;

/**
 * Whether a buy delivered to Robinhood Chain has arrived (plan P2b), once
 * the hub fill is in. Two honest signs, whichever comes first:
 *
 * - the relay's record of the delivery: `swaps.getSolvedIntentPacket`
 *   for the fill transaction on chain `robinhood`, whose `dst_tx_hash` is
 *   the transaction on Robinhood Chain that paid the token to the wallet;
 * - the wallet's balance of the token there rising above what it held as
 *   the order started (`run.baseline`, read by the order machine).
 *
 * Neither in the wait: `slow`, said calmly, with the token's explorer page;
 * the delivery itself carries on without the page. Nothing is asked while
 * `enabled` is false (every order that is not such a buy).
 */
export function useRobinhoodArrival({
  enabled,
  run,
  fillTxHash,
}: {
  enabled: boolean;
  run: RobinhoodRun | null;
  fillTxHash: string | undefined;
}): ArrivalState {
  const { sodax } = useSodaxContext();
  const on = enabled && run !== null;
  const packet = useQuery({
    queryKey: ["robinhood-arrival", "packet", fillTxHash],
    enabled: on && !!fillTxHash,
    staleTime: Infinity,
    retry: false,
    queryFn: async (): Promise<string> => {
      const found = await sodax.swaps.getSolvedIntentPacket({
        chainId: ChainKeys.ROBINHOOD_MAINNET,
        fillTxHash: fillTxHash as `0x${string}`,
        timeout: PACKET_WAIT_MS,
      });
      if (!found.ok) throw found.error instanceof Error ? found.error : new Error("no delivery packet");
      return found.value.dst_tx_hash;
    },
  });
  // The wait, counted from the moment the fill is in, per order: the key
  // that ran out is kept, so a new order starts its own wait.
  const waitKey = on ? `${run!.address}:${run!.rhAddress}:${fillTxHash ?? ""}` : null;
  const [waitedOutKey, setWaitedOutKey] = useState<string | null>(null);
  useEffect(() => {
    if (!waitKey) return;
    const timer = setTimeout(() => setWaitedOutKey(waitKey), PACKET_WAIT_MS);
    return () => clearTimeout(timer);
  }, [waitKey]);
  const waitedOut = waitKey !== null && waitedOutKey === waitKey;
  const slow = waitedOut || packet.isError;
  const baseline = run?.baseline;
  const balance = useQuery({
    queryKey: ["robinhood-arrival", "balance", run?.address, run?.rhAddress, fillTxHash ?? ""],
    enabled: on && baseline !== undefined && !packet.data,
    // Every five seconds, every thirty once the screen says slow (rh-ux-sec m1).
    refetchInterval: (query) =>
      arrivalPollMs({ arrived: query.state.data !== undefined && baseline !== undefined && query.state.data > baseline, slow }),
    retry: false,
    queryFn: async (): Promise<bigint> => {
      const [held] = await readRobinhoodBalances(robinhoodClient(), [{ rhAddress: run!.rhAddress }], [run!.address]);
      return held ?? 0n;
    },
  });

  return arrivalState({
    enabled: on,
    deliveryTx: packet.data,
    balance: balance.data,
    baseline,
    waitedOut: slow,
  });
}
