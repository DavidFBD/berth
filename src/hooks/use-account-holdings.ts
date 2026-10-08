"use client";

import { useQuery } from "@tanstack/react-query";
import { useSodaxContext } from "@sodax/dapp-kit";
import type { HubAccount } from "@/hooks/use-hub-account";
import { useDelivery } from "@/hooks/use-delivery";
import { LISTINGS_QUERY_KEY, type HubHoldings } from "@/hooks/use-hub-holdings";
import {
  heldOnly,
  mergeChainHoldings,
  placeReturnedTotals,
  placeRobinhoodTotals,
  robinhoodReadPlan,
  type AccountHolding,
  type RobinhoodReadState,
} from "@/lib/account-holdings";
import { readRobinhoodBalances, robinhoodClient } from "@/lib/robinhood-chain";
import { readReturned } from "@/lib/robinhood-returned";

/** Like the hub read: a fill invalidates `['listings']`, so this is only the idle refresh. */
const ROBINHOOD_REFETCH_MS = 60_000;

/** The whole read, past which it is unknown, whatever the endpoints are doing. */
const ROBINHOOD_READ_CAP_MS = 12_000;

/**
 * The account's holdings on both chains (lib/account-holdings), for showing
 * and valuing. Robinhood Chain is read for an account with an EVM wallet
 * (lib/account-holdings robinhoodReadPlan) whose Robinhood Chain side the
 * route says to read (lib/server/portfolio robinhoodReads: an order or a
 * holding there, or the delivery switch lets it buy there), once that
 * answer is in. For any other account no Robinhood Chain client is built
 * and no call leaves the browser, and the rows are the hub's exactly, with
 * `robinhood` 0, so the switches off leave the page as it was. A route
 * that does not answer reads, as before.
 *
 * `hub` is the caller's own useHubHoldings result, passed in so the two
 * share one read. Never spend from `balance`: a sell spends the hub only.
 */
export function useAccountHoldings(
  account: HubAccount,
  hub: HubHoldings,
): {
  holdings: AccountHolding[];
  held: AccountHolding[];
  /** The hub read has settled: the rows are known, the Robinhood Chain part as `robinhoodState` says. */
  settled: boolean;
  robinhoodState: RobinhoodReadState;
} {
  const { sodax } = useSodaxContext();
  // The route says whether this account has a Robinhood Chain side to read
  // (lib/server/portfolio robinhoodReads); yes until it answers otherwise.
  const delivery = useDelivery();
  const readsSide = delivery.settled && delivery.robinhoodReads;
  const plan = robinhoodReadPlan({ account, listings: hub.holdings.map((holding) => holding.listing) });
  const listingCount = hub.holdings.length;
  // What a sell from Robinhood Chain that did not fill left on Sonic, in the
  // hub wallet derived for (robinhood, each wallet) (lib/robinhood-returned):
  // shown and counted, never sold from. Read only for an account on
  // Robinhood Chain; unread is shown as nothing.
  const returnedQuery = useQuery({
    queryKey: [...LISTINGS_QUERY_KEY, "returned", plan?.owners.join(",") ?? ""],
    enabled: plan !== null && readsSide,
    refetchInterval: ROBINHOOD_REFETCH_MS,
    retry: 1,
    retryDelay: 800,
    queryFn: async (): Promise<bigint[]> => {
      if (!plan) throw new Error("no EVM wallet to read");
      const { total } = await readReturned(sodax.hubProvider as never, sodax.hubProvider.publicClient, plan.owners);
      return placeReturnedTotals(
        hub.holdings.map((holding) => holding.listing),
        total,
      );
    },
  });
  const query = useQuery({
    queryKey: [...LISTINGS_QUERY_KEY, "robinhood", plan?.owners.join(",") ?? ""],
    enabled: plan !== null && readsSide,
    refetchInterval: ROBINHOOD_REFETCH_MS,
    retry: 1,
    retryDelay: 800,
    queryFn: async (): Promise<bigint[]> => {
      if (!plan) throw new Error("no EVM wallet to read");
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const totals = await Promise.race([
          readRobinhoodBalances(robinhoodClient(), plan.tokens, plan.owners),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("Robinhood Chain read timed out")), ROBINHOOD_READ_CAP_MS);
          }),
        ]);
        return placeRobinhoodTotals(plan, totals, listingCount);
      } finally {
        clearTimeout(timer);
      }
    },
  });

  const robinhoodState: RobinhoodReadState =
    plan === null || (delivery.settled && !delivery.robinhoodReads)
      ? "off"
      : query.data
        ? "read"
        : query.isError
          ? "failed"
          : "loading";
  // A refetch that fails after a good read keeps the good read, as React Query keeps `data`.
  const holdings = mergeChainHoldings(
    hub.holdings,
    plan !== null && readsSide && query.data?.length === listingCount ? query.data : undefined,
    plan !== null && readsSide && returnedQuery.data?.length === listingCount ? returnedQuery.data : undefined,
  );
  return {
    holdings,
    held: hub.settled ? heldOnly(holdings) : [],
    settled: hub.settled,
    robinhoodState,
  };
}
