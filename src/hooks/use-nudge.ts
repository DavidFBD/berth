"use client";

import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DISPLAY_GC_MS } from "@/lib/query-freshness";
import { useAccount } from "@/hooks/use-account";
import { useEmbeddedHoldings } from "@/hooks/use-embedded-holdings";
import { useHubAccount } from "@/hooks/use-hub-account";
import { useHubHoldings } from "@/hooks/use-hub-holdings";
import { useProfile } from "@/hooks/use-profile";
import { HOME_CHAIN } from "@/lib/account";
import {
  activeSkips,
  factsQuery,
  type Nudge,
  type NudgeFacts,
  type NudgeKind,
  type NudgeResponse,
} from "@/lib/nudge";

/**
 * A dollar, not the dust floor: "your funds have arrived" said over eight
 * cents left from a sale would be a false sentence.
 */
const SPENDABLE_FLOOR_USD = 1;

/** Per browser: which lines were dismissed, and when. A convenience, never state that matters. */
const DISMISSED_KEY = "berth.nudge.dismissed";

function readDismissed(): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function writeDismissed(value: Record<string, number>): void {
  try {
    window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(value));
  } catch {
    // Private windows and blocked storage: the line simply comes back.
  }
}

/**
 * The one line worth saying to this account right now, or null.
 *
 * Asked only once every fact has settled, so a line is never said on the way
 * to being true: an account still loading its balances would otherwise be
 * told it is empty.
 */
export function useNudge(): { nudge: Nudge | null; dismiss: () => void } {
  const account = useHubAccount();
  const holdings = useHubHoldings(account.hubWallets);
  const funds = useEmbeddedHoldings();
  const profile = useProfile();
  const home = useAccount(HOME_CHAIN);
  // Read once, with the clock, when the hook mounts; a dismissal updates it.
  const [skip, setSkip] = useState<NudgeKind[]>(() =>
    typeof window === "undefined" ? [] : activeSkips(readDismissed(), Date.now()),
  );

  const settled =
    Boolean(account.spokeAddress) &&
    holdings.settled &&
    !funds.isLoading &&
    funds.totalUsd !== undefined &&
    // A network not read (failed, or slow past the sweep's deadline) may hold
    // the money: without it, "add funds" could be said to an account that has some.
    funds.erroredChains.length === 0 &&
    profile.data !== undefined;

  const facts: NudgeFacts | undefined = settled
    ? {
        held: holdings.held
          .filter((holding) => holding.listing.kind !== "vault")
          .map((holding) => holding.listing.symbol)
          .sort(),
        funds: (funds.totalUsd ?? 0) >= SPENDABLE_FLOOR_USD,
        canInvite: Boolean(profile.data?.referralCode),
        wallet: home.mode === "external",
        skip,
      }
    : undefined;
  const query = facts ? factsQuery(facts) : undefined;

  const result = useQuery({
    queryKey: ["nudge", query],
    enabled: query !== undefined,
    staleTime: 30 * 60_000,
    gcTime: DISPLAY_GC_MS,
    queryFn: async (): Promise<Nudge | null> => {
      const response = await fetch(`/api/nudge?${query}`);
      if (!response.ok) return null;
      return ((await response.json()) as NudgeResponse).nudge ?? null;
    },
  });

  const nudge = result.data ?? null;
  const dismiss = useCallback(() => {
    if (!nudge) return;
    const now = Date.now();
    const next = { ...readDismissed(), [nudge.kind]: now };
    writeDismissed(next);
    setSkip(activeSkips(next, now));
  }, [nudge]);

  return { nudge, dismiss };
}
