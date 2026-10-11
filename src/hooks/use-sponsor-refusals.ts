"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { DEPOSIT_SOURCE_CHAINS, getChainName } from "@/lib/chains";
import {
  GAS_SPONSOR_CHAIN_IDS,
  lateSponsoredSends,
  outcomeCheckPhase,
  outcomeHoldUntil,
  subscribeOutcomeCheck,
  type OutcomeCheckPhase,
  subscribeOutcomeHold,
  sponsorRefusals,
  sponsoredChainNames,
  subscribeSponsorRefusals,
} from "@/lib/gas-sponsor";
import { holdSecondsLeft } from "@/lib/outcome-note";

const NO_REFUSALS: ReadonlySet<number> = new Set();

/** The chains Privy refused to sponsor this session (lib/gas-sponsor), live. */
export function useSponsorRefusals(): ReadonlySet<number> {
  return useSyncExternalStore(subscribeSponsorRefusals, sponsorRefusals, () => NO_REFUSALS);
}

/**
 * The sponsored chains people can pay from, by name, minus any Privy
 * refused this session; empty when sponsorship is off. Says nothing about
 * the wallet: the caller shows it to email users only.
 */
export function useSponsoredChainNames(): string[] {
  const refusals = useSponsorRefusals();
  return useMemo(
    () =>
      sponsoredChainNames(
        DEPOSIT_SOURCE_CHAINS,
        getChainName,
        new Set([...GAS_SPONSOR_CHAIN_IDS].filter((id) => !refusals.has(id))),
      ),
    [refusals],
  );
}

/**
 * True for a minute after a sponsored send ended with an unknown outcome
 * (lib/gas-sponsor holdAfterUnknownOutcome): the order buttons stay off so
 * the same money cannot be sent twice. Re-renders when the hold ends.
 */
export function useOutcomeHold(): boolean {
  const until = useSyncExternalStore(subscribeOutcomeHold, outcomeHoldUntil, () => 0);
  // The hold whose minute has run out; it ends when this catches up.
  const [ended, setEnded] = useState(0);
  useEffect(() => {
    if (until === 0) return;
    const timer = setTimeout(() => setEnded(until), Math.max(0, until - Date.now()) + 50);
    return () => clearTimeout(timer);
  }, [until]);
  return until !== 0 && ended !== until;
}

export type OutcomeCheck = {
  phase: OutcomeCheckPhase;
  /** Whole seconds left of the hold, while it is on. */
  secondsLeft: number;
  /** A sponsored send is still out past its deadline: the hold lasts until it answers. */
  waiting: boolean;
};

/**
 * What Berth knows of the last sponsored send whose answer did not come
 * back clearly (lib/gas-sponsor watchOutcome), with the hold's countdown,
 * ticking once a second while it checks.
 */
export function useOutcomeCheck(): OutcomeCheck {
  const phase = useSyncExternalStore(subscribeOutcomeCheck, outcomeCheckPhase, () => "idle" as const);
  const until = useSyncExternalStore(subscribeOutcomeHold, outcomeHoldUntil, () => 0);
  const [now, setNow] = useState(() => Date.now());
  // Ticks whenever the hold is on, whatever the phase, so every countdown
  // shown moves; stops on its own once the hold is over.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const at = Date.now();
      setNow(at);
      // Next on the whole second, until the hold is over.
      if (at < until) timer = setTimeout(tick, Math.min(1000, until - at));
    };
    timer = setTimeout(tick, 0);
    return () => clearTimeout(timer);
  }, [until]);
  return {
    phase,
    secondsLeft: holdSecondsLeft(until, now),
    waiting: lateSponsoredSends() > 0,
  };
}
