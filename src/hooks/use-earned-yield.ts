"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";

import {
  anchorSnapshot,
  earnedUnderlying,
  nextAnchor,
  readAnchor,
  sameAnchor,
  subscribeAnchors,
  writeAnchor,
  type EarnedAnchor,
} from "@/lib/earned-yield";

export type EarnedYield = {
  /** Gain on the held shares in underlying units (18dp). Can be negative. */
  earned: bigint | undefined;
  /**
   * True when this is a true lifetime figure. False when we only met the
   * position after it was funded, making it growth since `since` — the card
   * must say so rather than pass it off as lifetime earnings.
   */
  exact: boolean;
  /** When counting began. Only meaningful while `exact` is false. */
  since: Date | undefined;
};

/** Nothing stored server-side; the first client render fills it in. */
const EMPTY_SNAPSHOT = "";

/**
 * Tracks what a vault position has earned, by folding each fresh share/price
 * reading into a persisted price-per-share anchor. See `lib/earned-yield` for
 * why the anchor is denominated in shares rather than dollars.
 *
 * Storage is the source of truth and is read through `useSyncExternalStore`,
 * so the effect only ever writes — no state to keep in step with it.
 *
 * Deliberately driven by observation rather than by the pour flow: a pour
 * settles cross-chain and its shares can land minutes later, so watching the
 * balance is both simpler and more reliable than hooking the mutation. It also
 * means growth that happened while the app was closed is still counted, since
 * each reading is compared against the persisted one, not a session value.
 */
export function useEarnedYield({
  vault,
  shares,
  pricePerShare,
  ownerKey,
}: {
  vault: string | undefined;
  shares: bigint;
  pricePerShare: bigint | undefined;
  ownerKey: string;
}): EarnedYield {
  const snapshot = useSyncExternalStore(
    subscribeAnchors,
    () => (vault ? anchorSnapshot(vault) : EMPTY_SNAPSHOT),
    () => EMPTY_SNAPSHOT,
  );

  useEffect(() => {
    // No wallet, or the price-per-share hasn't resolved: nothing to anchor
    // against yet.
    if (!vault || !ownerKey || pricePerShare === undefined) return;

    const stored = readAnchor(vault);
    const next = nextAnchor(stored, {
      shares,
      pps: pricePerShare,
      owner: ownerKey,
      now: new Date().toISOString(),
    });

    // Writing notifies the store, which re-renders us with the new snapshot.
    // Guarded so an unchanged reading cannot loop.
    if (!stored || !sameAnchor(stored, next)) writeAnchor(vault, next);
  }, [vault, shares, pricePerShare, ownerKey]);

  const anchor = useMemo(
    () => (snapshot ? (JSON.parse(snapshot) as EarnedAnchor) : undefined),
    [snapshot],
  );

  // A stale anchor from another holder set is discarded rather than misapplied;
  // the effect above replaces it on this same tick.
  if (!anchor || anchor.owner !== ownerKey || pricePerShare === undefined) {
    return { earned: undefined, exact: false, since: undefined };
  }

  return {
    earned: earnedUnderlying(anchor, shares, pricePerShare),
    exact: anchor.exact,
    since: new Date(anchor.since),
  };
}
