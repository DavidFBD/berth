"use client";

import { useCallback, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAccountHeaders } from "@/hooks/use-profile";
import { usePrivyEmbeddedWallet } from "@/hooks/use-privy-evm-wallet";
import { postMerge, type MergeOfferWire, type MergeStep } from "@/lib/account-merge-client";
import { clearWalletSession, forgetWalletSession } from "@/hooks/use-wallet-session";

export type { MergeOfferWire, MergeStep, MergeTotals } from "@/lib/account-merge-client";

/**
 * The merge in the browser (app/api/account/merge). An offer is only ever
 * handed out after both accounts were proved (a link that found the wallet
 * on another account, or an email code for an email that has one), so this
 * holds it, shows the confirm step, and on a yes asks for the merge with
 * the same session the offer was made to.
 *
 * After a merge the absorbed account's sessions end: a wallet session
 * already resolves to the survivor on its next request, and a Privy
 * session of the absorbed side is signed out here.
 */

type Snapshot = {
  step: MergeStep;
  offer: MergeOfferWire | null;
  /** The wallet the link proved, on the other account. */
  wallet: string | null;
  /** The wallet session the offer was made to, when it was not the normal identity. */
  asSession: string | null;
  xp: number;
  /** The merge ended this browser's sessions (this account joined the other). */
  signedOut: boolean;
  /** Runs the link again (new signatures, a new offer), for Start again. */
  retry: (() => Promise<void>) | null;
};

const INITIAL: Snapshot = { step: "idle", offer: null, wallet: null, asSession: null, xp: 0, signedOut: false, retry: null };
let snapshot: Snapshot = INITIAL;
const listeners = new Set<() => void>();
function set(patch: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...patch };
  for (const listener of listeners) listener();
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const read = () => snapshot;
const readServer = () => INITIAL;

/** Hand the confirm step an offer from a wallet link (hooks/use-account-wallets). */
export function offerWalletMerge(offer: MergeOfferWire, wallet: string, asSession?: string, retry?: () => Promise<void>): void {
  set({ step: "confirm", offer, wallet, asSession: asSession ?? null, xp: 0, signedOut: false, retry: retry ?? null });
}

/** The wallet merge's state and its two answers. */
export function useWalletMerge() {
  const current = useSyncExternalStore(subscribe, read, readServer);
  const { headers } = useAccountHeaders();
  const privy = usePrivyEmbeddedWallet();
  const queryClient = useQueryClient();

  const confirm = useCallback(async () => {
    const offer = snapshot.offer;
    if (!offer || snapshot.step !== "confirm") return;
    set({ step: "working" });
    const auth = snapshot.asSession ? { "x-wallet-session": snapshot.asSession } : await headers();
    const answer = auth ? await postMerge(auth, offer.offer) : ({ state: "expired" } as const);
    if (answer.state !== "merged") {
      set({ step: answer.state });
      return;
    }
    set({ step: "done", xp: answer.xp, offer: { ...offer, survivor: answer.survivor }, signedOut: answer.survivor === "other" });
    // The absorbed account's sessions end. The other one joined this: its
    // wallet's session here, if any, was made for it. This one joined the
    // other: every wallet session here was, and so was an email session.
    if (answer.survivor === "this") {
      if (snapshot.wallet) forgetWalletSession({ address: snapshot.wallet });
    } else {
      clearWalletSession();
      if (privy.authenticated) await privy.logout().catch(() => {});
    }
    void queryClient.invalidateQueries();
  }, [headers, privy, queryClient]);

  const close = useCallback(() => set({ ...INITIAL }), []);

  /**
   * Start again after an expired or changed offer: back to the ask, which
   * for a wallet is the link itself, signed afresh, so the confirm step
   * comes back with a new offer. Without a way to rerun it, the card closes.
   */
  const restart = useCallback(async () => {
    const retry = snapshot.retry;
    set({ ...INITIAL });
    if (retry) await retry();
  }, []);

  return { ...current, confirm, close, restart };
}
