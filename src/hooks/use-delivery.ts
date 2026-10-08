"use client";

import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccountHeaders } from "@/hooks/use-profile";
import { hubDelivery } from "@/lib/delivery";
import { askDelivery, onTheSwitch, type DeliveryAnswer } from "@/lib/delivery-client";

/** The query key root of the delivery answer; the order machine refreshes it when a buy finds the answer changed. */
export const DELIVERY_QUERY_KEY = ["delivery"] as const;

const UNANSWERED: DeliveryAnswer = { delivery: hubDelivery("read_failed"), answered: false, sell: false, robinhood: true };

/**
 * Where this session's next buy is delivered (app/api/delivery, plan P1a
 * and P2b), asked once per account and kept: an account the switch leaves
 * off is not asked again in the visit. What the account holds on Robinhood
 * Chain is read only when the answer's `robinhood` says so, or when no
 * answer came (hooks/use-account-holdings). Never asks a wallet for a
 * signature (`prompt: false`): a wallet browser without a pocketed
 * session simply reads as unanswered, the hub. The answer is the hub
 * until the route says otherwise, and on any failure.
 *
 * `ask` asks the route again, fresh, for the order machine to settle a
 * buy's destination at the moment it starts (lib/delivery-client
 * buyDestination); it may prompt for the sign in signature, as the pour
 * report that follows the buy does.
 */
export function useDelivery({ enabled = true }: { enabled?: boolean } = {}) {
  const { key, headers } = useAccountHeaders({ prompt: false });
  const { headers: promptHeaders } = useAccountHeaders();
  const query = useQuery({
    queryKey: [...DELIVERY_QUERY_KEY, key],
    enabled: enabled && key !== null,
    staleTime: (current) => (current.state.data && !onTheSwitch(current.state.data) && current.state.data.answered ? Infinity : 60_000),
    retry: false,
    queryFn: () => askDelivery({ headers }),
  });
  const answer = query.data ?? UNANSWERED;
  const ask = useCallback(async () => (await askDelivery({ headers: promptHeaders })).delivery, [promptHeaders]);
  return {
    /** The answer for the next buy; the hub until the route answers otherwise. */
    delivery: answer.delivery,
    /** Whether a sell from the wallet on Robinhood Chain may start (the sell switch, lib/server/delivery robinhoodSellOn). */
    robinhoodSell: answer.sell,
    /** Whether to read the account's Robinhood Chain side (lib/server/portfolio robinhoodReads); yes until answered otherwise. */
    robinhoodReads: answer.robinhood,
    /** The route answered, or gave up: the drawer may quote now. */
    settled: !enabled || key === null || query.isFetched,
    ask,
  };
}
