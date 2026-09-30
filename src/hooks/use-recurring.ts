"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccountHeaders } from "@/hooks/use-profile";
import { RECURRING_QUERY_KEY, type PlanInput, type RecurringResponse } from "@/lib/recurring";
import { RECURRING_PATH, RECURRING_UNAVAILABLE, RecurringError, readRecurringResponse } from "@/lib/recurring-response";

export { RECURRING_PATH, RECURRING_UNAVAILABLE, RecurringError, readRecurringResponse };

/**
 * Recurring buys on the page (app/api/recurring, lib/server/recurring):
 * the account's plans, the runs ready now, and the actions. Reads never
 * ask a wallet for a signature out of nowhere (a session already held, or
 * an email login); saving a plan may.
 */

export { RECURRING_QUERY_KEY };
const EMPTY: RecurringResponse = { plans: [], ready: [], limitAllowed: false };

export type RecurringAction =
  | { action: "create"; plan: PlanInput; via?: "app" | "assistant" }
  | { action: "update"; planId: string; plan: PlanInput }
  | { action: "pause" | "resume" | "delete"; planId: string }
  | { action: "open" | "skip"; runId: string };

async function post(headers: Record<string, string>, body: Record<string, unknown>): Promise<RecurringResponse> {
  const response = await fetch(RECURRING_PATH, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return readRecurringResponse(response);
}

export function useRecurring() {
  const { key, headers } = useAccountHeaders({ prompt: false });
  const query = useQuery({
    queryKey: [...RECURRING_QUERY_KEY, key],
    enabled: key !== null,
    staleTime: 60_000,
    // A run can come due while the page stays open (a local midnight); once a quarter hour is plenty.
    refetchInterval: 15 * 60_000,
    refetchIntervalInBackground: false,
    retry: 1,
    queryFn: async () => {
      const auth = await headers();
      if (!auth) return EMPTY;
      return post(auth, { action: "list" });
    },
  });
  return { ...(query.data ?? EMPTY), loaded: query.data !== undefined, isLoading: query.isLoading };
}

/**
 * One action; the answer is the fresh list, written straight into the
 * query. `prompt: false` for anything that runs without a tap (a link
 * opened at page load): it never asks a wallet to sign out of nowhere.
 */
export function useRecurringAction({ prompt = true }: { prompt?: boolean } = {}) {
  const { key, headers } = useAccountHeaders({ prompt });
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: RecurringAction) => {
      const auth = await headers();
      if (!auth) throw new RecurringError("no session");
      return post(auth, body);
    },
    onSuccess: (data) => {
      queryClient.setQueryData([...RECURRING_QUERY_KEY, key], data);
      void queryClient.invalidateQueries({ queryKey: RECURRING_QUERY_KEY });
    },
  });
}
