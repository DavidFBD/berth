"use client";

import { useQuery } from "@tanstack/react-query";
import type { HubAccount } from "@/hooks/use-hub-account";
import { LISTINGS_QUERY_KEY, type HubHoldings } from "@/hooks/use-hub-holdings";
import { useDelivery } from "@/hooks/use-delivery";
import {
  heldOnly,
  mergeChainHoldings,
  placeRobinhoodTotals,
  robinhoodReadPlan,
  type AccountHolding,
  type RobinhoodReadState,
} from "@/lib/account-holdings";
import { readRobinhoodBalances, robinhoodClient } from "@/lib/robinhood-chain";

/** Like the hub read: a fill invalidates `['listings']`, so this is only the idle refresh. */
const ROBINHOOD_REFETCH_MS = 60_000;

/** The whole read, past which it is unknown, whatever the endpoints are doing. */
const ROBINHOOD_READ_CAP_MS = 12_000;

/**
 * The account's holdings on both chains (lib/account-holdings), for showing
 * and valuing. Robinhood Chain is read only for an account the route says
 * is on the switch (hooks/use-delivery): for everyone else no Robinhood
 * Chain client is built and no call leaves the browser, and the rows are
 * the hub's exactly, with `robinhood` 0.
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
  const { switched } = useDelivery({ enabled: Boolean(account.spokeAddress) });
  const plan = robinhoodReadPlan({ switched, account, listings: hub.holdings.map((holding) => holding.listing) });
  const listingCount = hub.holdings.length;
  const query = useQuery({
    queryKey: [...LISTINGS_QUERY_KEY, "robinhood", plan?.owners.join(",") ?? ""],
    enabled: plan !== null,
    refetchInterval: ROBINHOOD_REFETCH_MS,
    retry: 1,
    retryDelay: 800,
    queryFn: async (): Promise<bigint[]> => {
      if (!plan) throw new Error("not on the switch");
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

  const robinhoodState: RobinhoodReadState = plan === null ? "off" : query.data ? "read" : query.isError ? "failed" : "loading";
  // A refetch that fails after a good read keeps the good read, as React Query keeps `data`.
  const holdings = mergeChainHoldings(
    hub.holdings,
    plan !== null && query.data?.length === listingCount ? query.data : undefined,
  );
  return {
    holdings,
    held: hub.settled ? heldOnly(holdings) : [],
    settled: hub.settled,
    robinhoodState,
  };
}
