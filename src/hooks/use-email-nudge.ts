"use client";

import { useCallback, useState } from "react";
import { useAccount } from "@/hooks/use-account";
import { useHubAccount } from "@/hooks/use-hub-account";
import { useHubHoldings } from "@/hooks/use-hub-holdings";
import { useProfile } from "@/hooks/use-profile";
import { HOME_CHAIN } from "@/lib/account";
import { shouldShowEmailNudge, VISITS_BEFORE_EARNED } from "@/lib/email-nudge";

/** Per browser: how many visits without a buy, and when it was last dismissed. Convenience, never state that matters. */
const VISITS_KEY = "berth.emailNudge.visits";
const DISMISSED_KEY = "berth.emailNudge.dismissedAt";

function readNumber(key: string): number | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function writeNumber(key: string, value: number): void {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Private windows and blocked storage: the strip shows a little sooner
    // or later next time, never crashes.
  }
}

/**
 * Bumped once per mount (a board visit), capped at what earns the line so a
 * browser that never buys does not grow the counter forever.
 */
function bumpVisits(): number {
  const current = readNumber(VISITS_KEY) ?? 0;
  const next = Math.min(current + 1, VISITS_BEFORE_EARNED);
  if (next !== current) writeNumber(VISITS_KEY, next);
  return next;
}

/**
 * Whether the "add an email" strip should show for this account right now,
 * and how to dismiss it. `otherStripShowing` is the caller's word on whether
 * a higher-priority strip (waiting orders, the unlinked-wallet prompt) is
 * already in the same slot; see lib/email-nudge for the priority.
 */
export function useEmailNudge(otherStripShowing: boolean): { show: boolean; dismiss: () => void } {
  const account = useHubAccount();
  const holdings = useHubHoldings(account.hubWallets);
  const profile = useProfile();
  const home = useAccount(HOME_CHAIN);
  const [visits] = useState<number>(() => (typeof window === "undefined" ? 0 : bumpVisits()));
  const [dismissedAt, setDismissedAt] = useState<number | null>(() =>
    typeof window === "undefined" ? null : readNumber(DISMISSED_KEY),
  );
  // Read once, at mount, like the dismissal window itself: a week's passing
  // is noticed on the next visit, not while one page stays open.
  const [mountedAt] = useState<number>(() => Date.now());

  const settled = Boolean(account.spokeAddress) && holdings.settled && profile.data !== undefined;
  const show =
    settled &&
    home.mode === "external" &&
    shouldShowEmailNudge(
      {
        hasEmail: Boolean(profile.data?.hasEmail),
        boughtBefore: holdings.held.some((holding) => holding.listing.kind === "stock"),
        visits,
        dismissedAt,
        otherStripShowing,
      },
      mountedAt,
    );

  const dismiss = useCallback(() => {
    const now = Date.now();
    writeNumber(DISMISSED_KEY, now);
    setDismissedAt(now);
  }, []);

  return { show, dismiss };
}
