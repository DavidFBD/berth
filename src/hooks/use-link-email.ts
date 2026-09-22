"use client";

import { useCallback, useSyncExternalStore } from "react";
import { getAddress } from "viem";
import { useQueryClient } from "@tanstack/react-query";
import { useLinkEmail as usePrivyLinkEmail, useLoginWithSiwe } from "@privy-io/react-auth";
import { useXSignMessage } from "@sodax/wallet-sdk-react";
import { announceRewards } from "@/components/xp-toast";
import { usePrivyEmbeddedWallet } from "@/hooks/use-privy-evm-wallet";
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
 * Every way out (done, cancel, taken, a failure) ends the session it
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
  | "done"
  /** The address already belongs to a different Privy account. */
  | "taken";

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
};

const INITIAL: Snapshot = {
  state: "idle",
  error: null,
  pendingEmail: "",
  resent: false,
  startedSession: false,
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
  return state !== "idle" && state !== "email" && state !== "done" && state !== "taken";
}

/**
 * True while a link is under way. The header keeps showing the wallet
 * account, the rewards identity stays on the wallet, and the session guard
 * leaves the scaffolding session alone.
 */
export function useLinkInProgress(): boolean {
  const current = useSyncExternalStore(subscribe, read, readServer);
  return inProgress(current.state) || current.startedSession;
}

const BASE_CHAIN_ID = 8453;

/** Privy reports the cause on the error object rather than by type. */
function privyErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { privyErrorCode?: unknown }).privyErrorCode;
  return typeof code === "string" ? code : undefined;
}

/** A wallet's "no", which is a choice and not a failure. EIP-1193 4001. */
function isDecline(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return (
    code === 4001 ||
    code === "ACTION_REJECTED" ||
    (typeof message === "string" && /reject|denied|declined|cancel/i.test(message))
  );
}

export function useLinkEmail(): Snapshot & {
  open: () => void;
  cancel: () => void;
  submitEmail: (email: string, address: string) => Promise<void>;
  submitCode: (code: string) => Promise<void>;
  resend: () => Promise<void>;
} {
  const current = useSyncExternalStore(subscribe, read, readServer);
  const privy = usePrivyEmbeddedWallet();
  const queryClient = useQueryClient();
  const { generateSiweMessage, loginWithSiwe } = useLoginWithSiwe();
  const { sendCode, linkWithCode } = usePrivyLinkEmail();
  const { mutateAsync: sign } = useXSignMessage();
  const { logout, getAccessToken } = privy;

  /** Close what this flow opened, then land on `patch`. */
  const finish = useCallback(
    async (patch: Partial<Snapshot>) => {
      const started = snapshot.startedSession;
      set({ ...patch, startedSession: false });
      if (started) await logout().catch(() => {});
      // Whatever the rewards panel knew was keyed to a session now gone.
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
    [logout, queryClient],
  );

  const open = useCallback(() => set({ ...INITIAL, state: "email" }), []);

  const cancel = useCallback(() => {
    void finish({ ...INITIAL });
  }, [finish]);

  const submitEmail = useCallback(
    async (email: string, address: string) => {
      if (!privy.enabled || !privy.ready || inProgress(snapshot.state)) return;
      set({ error: null, resent: false, pendingEmail: email });
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
        }
        set({ state: "sending" });
        await sendCode({ email });
        set({ state: "code" });
      } catch (error) {
        if (privyErrorCode(error) === "linked_to_another_user") {
          await finish({ state: "taken", error: null });
        } else if (isDecline(error)) {
          await finish({ state: "email", error: null });
        } else {
          await finish({ state: "email", error: "failed" });
        }
      }
    },
    [privy.enabled, privy.ready, privy.authenticated, generateSiweMessage, sign, loginWithSiwe, sendCode, finish],
  );

  const resend = useCallback(async () => {
    if (snapshot.state !== "code" || !snapshot.pendingEmail) return;
    try {
      await sendCode({ email: snapshot.pendingEmail });
      set({ resent: true, error: null });
    } catch {
      set({ error: "failed" });
    }
  }, [sendCode]);

  const submitCode = useCallback(
    async (code: string) => {
      if (snapshot.state !== "code") return;
      set({ state: "verifying", error: null });
      try {
        await linkWithCode({ code });
      } catch (error) {
        if (privyErrorCode(error) === "linked_to_another_user") {
          await finish({ state: "taken" });
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
      set({ state: "saving" });
      // Three tries, because this is the one moment the row can learn it:
      // once the session closes, a wallet account never signs in to Privy
      // again. The server answers 503 rather than guess when Privy itself is
      // slow (lib/server/rewards-route), which is what the retries are for.
      for (let attempt = 0; attempt < 3; attempt += 1) {
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
          if (response.ok) {
            const data = (await response.json()) as ProfileResponse;
            announceRewards(data.rewards, data.xp);
            break;
          }
        } catch {
          // Try again below.
        }
        await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
      }
      await finish({ state: "done", error: null });
    },
    [linkWithCode, getAccessToken, finish],
  );

  return { ...current, open, cancel, submitEmail, submitCode, resend };
}
