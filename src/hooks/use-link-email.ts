"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { getAddress } from "viem";
import { useQueryClient } from "@tanstack/react-query";
import { useLinkEmail as usePrivyLinkEmail, useLoginWithEmail, useLoginWithSiwe } from "@privy-io/react-auth";
import { useXSignMessage } from "@sodax/wallet-sdk-react";
import { announceRewards } from "@/components/xp-toast";
import { usePrivyEmbeddedWallet } from "@/hooks/use-privy-evm-wallet";
import { postMerge, type MergeOfferWire, type MergeStep } from "@/lib/account-merge-client";
import { createSiweMessage } from "viem/siwe";
import { proofResource, proofStatement } from "@/lib/account-proof";
import { forgetWalletSession } from "@/hooks/use-wallet-session";
import type { ProfileResponse } from "@/lib/profile-types";

/**
 * Putting an email on a wallet account, in the one order that does not move
 * the account, and in the order a person would expect.
 *
 * Three earlier versions were wrong, each instructively.
 *
 * The first called `privy.login`, which mints an embedded wallet, which
 * hands the money account to an address the user never chose. So the rule is
 * never to let one be created: signing in with the WALLET does not create
 * one, because `createOnLogin` is "users-without-wallets" and this user has a
 * wallet.
 *
 * The second signed before saying what it was for, and its button unmounted
 * itself when signing in flipped `authenticated`.
 *
 * The third fixed the order but kept the Privy session afterwards, and a
 * session with no embedded wallet is a state the rest of the app has no
 * screen for: the header showed an account opening forever, the rewards
 * identity switched to the DID, and on a shared browser the next wallet to
 * connect inherited the first person's rewards. Its state also lived in a
 * component that the session change unmounted, so the code arrived with
 * nowhere to type it (review of 2026-09-22).
 *
 * So now the Privy session is scaffolding, not a place to live:
 *
 *   1. The user types an email and submits.
 *   2. The wallet signs Privy's SIWE message (a plain signature, no gas).
 *   3. Privy sends a code; the user types it back and it links.
 *   4. One rewards sync with that session, so the server attaches the DID
 *      and the email to the wallet's own row and pays the email XP.
 *   5. The Privy session is ended. The person is a wallet user again, as
 *      they were, now with an email on their account.
 *
 * When the email already has a Berth account of its own (Privy answers
 * `linked_to_another_user`), this is not a dead end but the merge
 * (docs/plans/account-linking.md, phase 3). The person must open that
 * account once with a code, which is the fresh proof of the email side;
 * this browser's wallet session is the proof of the other. Then the
 * confirm step says who stays and what comes along, and nothing happens
 * until they say yes (app/api/account/merge). If Privy says so before any
 * code was entered, the login code simply takes the link code's place and
 * the screen reads exactly the same, so no one learns an email has an
 * account without its inbox.
 *
 * Every way out (done, cancel, a merge, a failure) ends the session it
 * started. The flow's state lives in this module rather than in a component,
 * so nothing that re-renders or unmounts mid-flow can lose it, and
 * `useLinkInProgress` lets the header and the rewards identity hold still
 * while it runs.
 */

export type LinkEmailState =
  | "idle"
  /** The email field is open and waiting. */
  | "email"
  /** Waiting for the wallet to sign Privy's message. */
  | "signing"
  /** Asking Privy to send the code. */
  | "sending"
  /** The code field is open and waiting. */
  | "code"
  | "verifying"
  /** Linked; telling the rewards row and closing the session. */
  | "saving"
  /**
   * Linked on Privy, but the rewards row could not be told. The session is
   * kept open on purpose: it is the only thing that can tell it, so "Try
   * again" retries just the save and Cancel gives up.
   */
  | "saveFailed"
  | "done"
  /**
   * The code was right, but the email has a Berth account already. Asks
   * whether to bring this wallet into it (one more code opens it).
   */
  | "mergeAsk"
  /** Sending the code that opens the email's own account. */
  | "mergeSending"
  /** The email's account is open; the wallet signs that it is theirs too. */
  | "mergeSigning"
  /** Both sides proved: the confirm step, with the offer. */
  | "mergeConfirm"
  /** The two accounts are one. */
  | "mergeDone";

/** What went wrong at the step the person is back on, if anything. */
export type LinkEmailError = "failed" | "codeWrong" | null;

type Snapshot = {
  state: LinkEmailState;
  error: LinkEmailError;
  pendingEmail: string;
  /** A code was sent again on request; says so under the field. */
  resent: boolean;
  /** This flow signed in to Privy, so this flow must sign out. */
  startedSession: boolean;
  /** The wallet the flow is for; a different wallet connecting ends it. */
  address: string;
  /**
   * Which code the field is for: linking the email to this wallet, or
   * opening the email's own account (the merge's proof of the email side).
   */
  codeMode: "link" | "login";
  /** The login code is the second one the person gets (after mergeAsk). */
  secondCode: boolean;
  /** The merge offer, once both sides are proved. */
  merge: MergeOfferWire | null;
  /** Where the confirm step is. */
  mergeStep: MergeStep;
  /** The joined account's XP, once merged. */
  mergeXp: number;
};

const INITIAL: Snapshot = {
  state: "idle",
  error: null,
  pendingEmail: "",
  resent: false,
  startedSession: false,
  address: "",
  codeMode: "link",
  secondCode: false,
  merge: null,
  mergeStep: "idle",
  mergeXp: 0,
};

let snapshot: Snapshot = INITIAL;
const listeners = new Set<() => void>();
function set(patch: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...patch };
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const read = () => snapshot;
const readServer = () => INITIAL;

/** Mid-flow: a Privy session may exist that is not somewhere to stay. */
function inProgress(state: LinkEmailState): boolean {
  return state !== "idle" && state !== "email" && state !== "done" && state !== "mergeAsk" && state !== "mergeDone";
}

/**
 * True while a link is under way. The header keeps showing the wallet
 * account, the rewards identity stays on the wallet, and the session guard
 * leaves the scaffolding session alone.
 */
export function useLinkInProgress(): boolean {
  const current = useSyncExternalStore(subscribe, read, readServer);
  return inProgress(current.state) || current.startedSession || mergeLeftOpen();
}

/**
 * Set while this flow holds the session of an email's own account (the
 * merge's proof of the email side). A reload loses the flow but not the
 * session, and the browser would open as that email's account with no
 * word why; this mark survives the reload, so the session is ended and
 * the person told (useInterruptedMerge).
 */
const MERGE_OPEN_KEY = "berth.merge-open";

function mergeLeftOpen(): boolean {
  if (typeof window === "undefined" || snapshot.startedSession) return false;
  try {
    return window.sessionStorage.getItem(MERGE_OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

function markMergeOpen(open: boolean): void {
  try {
    if (open) window.sessionStorage.setItem(MERGE_OPEN_KEY, "1");
    else window.sessionStorage.removeItem(MERGE_OPEN_KEY);
  } catch {
    // Storage refused: a reload mid merge then opens as that account.
  }
}

/**
 * For the app shell (AuthGate): a merge the page reloaded in the middle of
 * leaves the email account's session open. End it, and say nothing was
 * joined.
 */
export function useInterruptedMerge(onInterrupted: () => void): void {
  const privy = usePrivyEmbeddedWallet();
  const { logout } = privy;
  useEffect(() => {
    if (!privy.ready || snapshot.state !== "idle" || !mergeLeftOpen()) return;
    void logout()
      .catch(() => {})
      .finally(() => {
        markMergeOpen(false);
        set({});
        onInterrupted();
      });
  }, [privy.ready, logout, onInterrupted]);
}

const BASE_CHAIN_ID = 8453;

/** Privy reports the cause on the error object rather than by type. */
function privyErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { privyErrorCode?: unknown }).privyErrorCode;
  return typeof code === "string" ? code : undefined;
}

/**
 * A wallet's "no", which is a choice and not a failure. EIP-1193 4001.
 * Deliberately narrow: a looser match on "cancel" would also swallow a
 * request cancelled by the network, which is a failure the person should see.
 */
function isDecline(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return (
    code === 4001 ||
    code === "ACTION_REJECTED" ||
    (typeof message === "string" && /user rejected|user denied|rejected the request/i.test(message))
  );
}

/** Wait for Privy to publish the user a login just created, up to 5 seconds. */
async function signedIn(userRef: { current: unknown }, timeoutMs = 5000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!userRef.current && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Wait for Privy to let go of a session just ended, up to 5 seconds. */
async function signedOut(userRef: { current: unknown }, timeoutMs = 5000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (userRef.current && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/**
 * `address` is the wallet account the panel is showing. If a different
 * wallet takes its place mid-flow, the flow is for someone who is no longer
 * here, so it is ended and its session closed.
 */
export function useLinkEmail(address: string | undefined): Snapshot & {
  open: () => void;
  cancel: () => void;
  submitEmail: (email: string, address: string) => Promise<void>;
  submitCode: (code: string) => Promise<void>;
  resend: () => Promise<void>;
  retrySave: () => Promise<void>;
  /** mergeAsk: send the code that opens the email's own account. */
  startMerge: () => Promise<void>;
  /** mergeConfirm: bring the wallet in. */
  confirmMerge: () => Promise<void>;
  /** An expired or changed offer: back to the ask, where a new code proves the email again. */
  restartMerge: () => Promise<void>;
} {
  const current = useSyncExternalStore(subscribe, read, readServer);
  const privy = usePrivyEmbeddedWallet();
  const queryClient = useQueryClient();
  const { generateSiweMessage, loginWithSiwe } = useLoginWithSiwe();
  const { sendCode, linkWithCode } = usePrivyLinkEmail();
  const { sendCode: sendLoginCode, loginWithCode } = useLoginWithEmail();
  const { mutateAsync: sign } = useXSignMessage();
  const { logout, getAccessToken } = privy;

  // Privy's sendCode is a callback over its signed-in user. The copy this
  // render holds was made while the wallet was still signed out, so after
  // loginWithSiwe it would throw must_be_authenticated. The refs always hold
  // the latest render's sendCode and user.
  const sendCodeRef = useRef(sendCode);
  const sendLoginCodeRef = useRef(sendLoginCode);
  const loginWithCodeRef = useRef(loginWithCode);
  const userRef = useRef(privy.user);
  useEffect(() => {
    sendCodeRef.current = sendCode;
    sendLoginCodeRef.current = sendLoginCode;
    loginWithCodeRef.current = loginWithCode;
    userRef.current = privy.user;
  });

  /**
   * Close what this flow opened, then land on `patch`. The session is ended
   * BEFORE the flow lets go of it: cleared first, the session guard in
   * AuthGate would see a wallet account's Privy session with no flow holding
   * it, treat it as stray, and blank the whole app to a splash while it
   * logged out a second time.
   */
  const finish = useCallback(
    async (patch: Partial<Snapshot>) => {
      if (snapshot.startedSession) await logout().catch(() => {});
      markMergeOpen(false);
      set({ ...patch, startedSession: false });
      // Whatever the rewards panel knew was keyed to a session now gone.
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
    [logout, queryClient],
  );

  useEffect(() => {
    const flowAddress = snapshot.address;
    if (!flowAddress || snapshot.state === "idle") return;
    if (address && address.toLowerCase() === flowAddress.toLowerCase()) return;
    void finish({ ...INITIAL });
  }, [address, finish]);

  const open = useCallback(() => set({ ...INITIAL, state: "email" }), []);

  /**
   * Ask for the code that opens the email's own account: the scaffolding
   * session (if any) ends first, since Privy holds one session at a time.
   * `disableSignup`: this only ever runs for an email Privy knows, and it
   * must never make a new Privy user (and with it an embedded wallet).
   */
  const sendOpeningCode = useCallback(
    async (email: string) => {
      if (snapshot.startedSession || userRef.current) {
        await logout().catch(() => {});
        set({ startedSession: false });
        await signedOut(userRef);
      }
      await sendLoginCodeRef.current({ email, disableSignup: true });
    },
    [logout],
  );

  const cancel = useCallback(() => {
    void finish({ ...INITIAL });
  }, [finish]);

  const submitEmail = useCallback(
    async (email: string, address: string) => {
      if (!privy.enabled || !privy.ready || inProgress(snapshot.state)) return;
      set({ error: null, resent: false, pendingEmail: email, address });
      try {
        if (!privy.authenticated) {
          set({ state: "signing" });
          const message = await generateSiweMessage({
            address: getAddress(address),
            chainId: `eip155:${BASE_CHAIN_ID}`,
          });
          const signature = await sign({ xChainType: "EVM", message });
          if (typeof signature !== "string" || !signature.startsWith("0x")) {
            set({ state: "email" });
            return;
          }
          // Marked before the call returns: if it lands and anything after
          // throws, the session still gets closed.
          set({ startedSession: true });
          await loginWithSiwe({ message, signature });
          await signedIn(userRef);
        }
        set({ state: "sending" });
        try {
          await sendCodeRef.current({ email });
          set({ state: "code", codeMode: "link" });
        } catch (error) {
          if (privyErrorCode(error) !== "linked_to_another_user") throw error;
          // Nothing proved yet: the screen must read as for any email. The
          // code that opens the email's own account takes the link code's
          // place, and entering it is the proof.
          await sendOpeningCode(email);
          set({ state: "code", codeMode: "login" });
        }
      } catch (error) {
        console.warn("[link-email] submitEmail failed:", privyErrorCode(error) ?? (error instanceof Error ? error.name : "unknown"));
        if (isDecline(error)) {
          await finish({ state: "email", error: null });
        } else {
          await finish({ state: "email", error: "failed" });
        }
      }
    },
    [privy.enabled, privy.ready, privy.authenticated, generateSiweMessage, sign, loginWithSiwe, finish, sendOpeningCode],
  );

  const resend = useCallback(async () => {
    if (snapshot.state !== "code" || !snapshot.pendingEmail) return;
    try {
      if (snapshot.codeMode === "login") await sendLoginCodeRef.current({ email: snapshot.pendingEmail, disableSignup: true });
      else await sendCodeRef.current({ email: snapshot.pendingEmail });
      set({ resent: true, error: null });
    } catch {
      set({ error: "failed" });
    }
  }, []);

  /**
   * Three tries, because this is the one moment the row can learn it: once
   * the session closes, a wallet account never signs in to Privy again. The
   * server answers 503 rather than guess while Privy is slow
   * (lib/server/rewards-route). Saved means the row now says it has an
   * email, not merely that the request returned: Privy can take a moment to
   * report a link it has just made, and a 200 without the email is a retry.
   * If it never lands, the session stays open for "Try again".
   */
  const save = useCallback(async () => {
    set({ state: "saving", error: null });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
      try {
        const token = await getAccessToken();
        const response = await fetch("/api/profile", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({}),
        });
        if (!response.ok) continue;
        const data = (await response.json()) as ProfileResponse;
        if (!data.hasEmail) continue;
        announceRewards(data.rewards, data.xp);
        await finish({ state: "done", error: null });
        return;
      } catch {
        // Try again.
      }
    }
    set({ state: "saveFailed", error: "failed" });
  }, [getAccessToken, finish]);

  /**
   * The email's own account is open (its code just entered). The wallet's
   * side is proved now too: it signs a merge nonce issued to that DID for
   * this wallet (a week old wallet session is not enough), and the server
   * answers the offer. Anything but an offer ends the flow calmly.
   */
  const askOffer = useCallback(async () => {
    const address = snapshot.address;
    const fail = (step: "failed" | "expired" = "failed") =>
      finish({
        ...INITIAL,
        state: step === "expired" ? "mergeAsk" : "email",
        error: "failed",
        mergeStep: step === "expired" ? "expired" : "idle",
        pendingEmail: snapshot.pendingEmail,
        address,
      });
    const post = async (path: string, body: Record<string, unknown>) => {
      const token = await getAccessToken().catch(() => null);
      if (!token) return { status: 0, data: null as Record<string, unknown> | null };
      const response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      return { status: response.status, data: (await response.json().catch(() => null)) as Record<string, unknown> | null };
    };
    try {
      const nonce = await post("/api/account/merge/nonce", { wallet: address });
      if (nonce.status === 401) return void (await fail("expired"));
      if (typeof nonce.data?.nonce !== "string" || typeof nonce.data?.nonceToken !== "string") return void (await fail());
      set({ state: "mergeSigning" });
      const target = address.toLowerCase();
      const message = createSiweMessage({
        address: getAddress(address),
        chainId: 146,
        domain: window.location.host,
        uri: window.location.origin,
        nonce: nonce.data.nonce,
        version: "1",
        statement: proofStatement("merge", target),
        resources: [proofResource("merge", target)],
      });
      let signature: unknown;
      try {
        signature = await sign({ xChainType: "EVM", message });
      } catch (error) {
        if (isDecline(error)) return void (await finish({ ...INITIAL, state: "mergeAsk", pendingEmail: snapshot.pendingEmail, address }));
        throw error;
      }
      if (typeof signature !== "string" || !signature.startsWith("0x")) {
        return void (await finish({ ...INITIAL, state: "mergeAsk", pendingEmail: snapshot.pendingEmail, address }));
      }
      const offered = await post("/api/account/merge/offer", { nonceToken: nonce.data.nonceToken, message, signature });
      if (offered.status === 401) return void (await fail("expired"));
      const data = offered.data as ({ state?: string } & Partial<MergeOfferWire>) | null;
      if (data?.state === "offer" && data.offer && data.survivor && data.together) {
        set({
          state: "mergeConfirm",
          merge: { offer: data.offer, survivor: data.survivor, together: data.together, usernameComes: data.usernameComes },
          mergeStep: "confirm",
        });
        return;
      }
    } catch {
      // Falls through to the failure below.
    }
    await fail();
  }, [getAccessToken, finish, sign]);

  const submitCode = useCallback(
    async (code: string) => {
      if (snapshot.state !== "code") return;
      set({ state: "verifying", error: null });
      if (snapshot.codeMode === "login") {
        try {
          set({ startedSession: true });
          markMergeOpen(true);
          await loginWithCodeRef.current({ code });
          await signedIn(userRef);
        } catch {
          set({ state: "code", error: "codeWrong" });
          return;
        }
        await askOffer();
        return;
      }
      try {
        await linkWithCode({ code });
      } catch (error) {
        if (privyErrorCode(error) === "linked_to_another_user") {
          // The code was right: the inbox is theirs, and it has an account.
          await finish({ state: "mergeAsk", error: null });
        } else {
          // Wrong or expired: the session stays, so a retry or a resend
          // needs no second signature.
          set({ state: "code", error: "codeWrong" });
        }
        return;
      }

      // Linked on Privy's side. Tell the rewards row while this session can
      // still prove who it is; the server resolves the wallet from Privy and
      // attaches the DID and the email to that wallet's own row.
      await save();
    },
    [linkWithCode, save, finish, askOffer],
  );

  const retrySave = useCallback(async () => {
    if (snapshot.state !== "saveFailed") return;
    await save();
  }, [save]);

  const startMerge = useCallback(async () => {
    if (snapshot.state !== "mergeAsk" || !snapshot.pendingEmail) return;
    set({ state: "mergeSending", error: null, resent: false });
    try {
      await sendOpeningCode(snapshot.pendingEmail);
      set({ state: "code", codeMode: "login", secondCode: true });
    } catch {
      await finish({ ...INITIAL, state: "mergeAsk", pendingEmail: snapshot.pendingEmail, address: snapshot.address, error: "failed" });
    }
  }, [sendOpeningCode, finish]);

  const confirmMerge = useCallback(async () => {
    const offer = snapshot.merge;
    if (snapshot.state !== "mergeConfirm" || !offer || snapshot.mergeStep === "working") return;
    set({ mergeStep: "working" });
    const token = await getAccessToken().catch(() => null);
    const answer = token ? await postMerge({ authorization: `Bearer ${token}` }, offer.offer) : ({ state: "expired" } as const);
    if (answer.state !== "merged") {
      set({ mergeStep: answer.state });
      return;
    }
    // The email's session was only the proof; the wallet stays the way in,
    // with a new sign in: its old session was made for the account that
    // just joined, and the server now refuses it.
    forgetWalletSession({ address: snapshot.address });
    await finish({ state: "mergeDone", mergeStep: "done", mergeXp: answer.xp, error: null });
    void queryClient.invalidateQueries();
  }, [getAccessToken, finish, queryClient]);

  const restartMerge = useCallback(async () => {
    if (snapshot.state !== "mergeConfirm") return;
    await finish({ ...INITIAL, state: "mergeAsk", pendingEmail: snapshot.pendingEmail, address: snapshot.address });
  }, [finish]);

  return { ...current, open, cancel, submitEmail, submitCode, resend, retrySave, startMerge, confirmMerge, restartMerge };
}
