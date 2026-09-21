"use client";

import { useCallback, useState } from "react";
import { getAddress } from "viem";
import { useLinkEmail as usePrivyLinkEmail, useLoginWithSiwe } from "@privy-io/react-auth";
import { useXSignMessage } from "@sodax/wallet-sdk-react";
import { usePrivyEmbeddedWallet } from "@/hooks/use-privy-evm-wallet";

/**
 * Putting an email on a wallet account, in the one order that does not move
 * the account, and in the order a person would expect.
 *
 * Two earlier versions of this were wrong, both instructively.
 *
 * The first called `privy.login`, which mints an embedded wallet, which
 * hands the money account to an address the user never chose: lib/account
 * gives the account to whichever address wins on the home chain, and an
 * email session wins there whenever an embedded wallet exists. So the rule
 * is to never let one be created. Signing in with the WALLET does not create
 * one, because `createOnLogin` is "users-without-wallets" and this user has
 * a wallet, so the session lands anchored to the address that already owned
 * the account.
 *
 * The second got that right and the order wrong. It signed first and asked
 * for the email afterwards, through Privy's modal, which meant a person was
 * asked to sign before being told what they were adding. Worse, signing in
 * flipped `authenticated`, the button's own gate read that, and the button
 * unmounted itself mid-flow so the email step never ran at all.
 *
 * So the email is collected first, in our own field, and the signature is
 * the second step of a thing already explained. Privy's headless
 * `useLinkEmail` keeps the code exchange inside our UI rather than bouncing
 * to a modal that can be orphaned by a re-render:
 *
 *   1. The user types an email and submits.
 *   2. The wallet signs Privy's SIWE message, through the same
 *      `useXSignMessage` the rewards session already uses.
 *   3. Privy sends a code to that address; the user types it back.
 *
 * Nothing is sent on chain and no gas is spent; step 2 is a plain message
 * signature. Bound to Base because that is HOME_CHAIN and therefore the
 * chain the account is a function of. The wallet may label the prompt with
 * whatever network it currently has selected, which is cosmetic.
 *
 * The server needs the fallback in lib/server/privy to see this user's
 * external wallet, or the claim cannot find their existing row.
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
  | "done"
  /** The address already belongs to a different Privy account. */
  | "taken"
  | "failed";

const BASE_CHAIN_ID = 8453;

/** Privy reports the cause on the error object rather than by type. */
function privyErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { privyErrorCode?: unknown }).privyErrorCode;
  return typeof code === "string" ? code : undefined;
}

export function useLinkEmail({ onLinked }: { onLinked?: () => void } = {}): {
  state: LinkEmailState;
  /** The address the code went to, for the "we sent a code to…" line. */
  pendingEmail: string;
  open: () => void;
  cancel: () => void;
  submitEmail: (email: string, address: string) => Promise<void>;
  submitCode: (code: string) => Promise<void>;
} {
  const privy = usePrivyEmbeddedWallet();
  const [state, setState] = useState<LinkEmailState>("idle");
  const [pendingEmail, setPendingEmail] = useState("");
  const { generateSiweMessage, loginWithSiwe } = useLoginWithSiwe();
  const { sendCode, linkWithCode } = usePrivyLinkEmail();
  const { mutateAsync: sign } = useXSignMessage();

  const open = useCallback(() => setState("email"), []);
  const cancel = useCallback(() => {
    setState("idle");
    setPendingEmail("");
  }, []);

  const submitEmail = useCallback(
    async (email: string, address: string) => {
      if (!privy.enabled || !privy.ready) return;
      try {
        // A session already in hand needs no second signature: this is the
        // user who signed, then mistyped the code and came back.
        if (!privy.authenticated) {
          setState("signing");
          const message = await generateSiweMessage({
            address: getAddress(address),
            chainId: `eip155:${BASE_CHAIN_ID}`,
          });
          const signature = await sign({ xChainType: "EVM", message });
          if (typeof signature !== "string" || !signature.startsWith("0x")) {
            // Declined, which is not a failure: put the field back as it was.
            setState("email");
            return;
          }
          await loginWithSiwe({ message, signature });
        }
        setState("sending");
        await sendCode({ email });
        setPendingEmail(email);
        setState("code");
      } catch (error) {
        setState(
          privyErrorCode(error) === "linked_to_another_user" ? "taken" : "email",
        );
      }
    },
    [
      privy.enabled,
      privy.ready,
      privy.authenticated,
      generateSiweMessage,
      sign,
      loginWithSiwe,
      sendCode,
    ],
  );

  const submitCode = useCallback(
    async (code: string) => {
      setState("verifying");
      try {
        await linkWithCode({ code });
        setState("done");
        // The row only learns it has an email on the next sync, which is
        // also where the XP ceremony is played.
        onLinked?.();
      } catch (error) {
        // The honest ending of the path that once signed a user into a
        // stranger's account: say whose it is, do not become them.
        setState(
          privyErrorCode(error) === "linked_to_another_user" ? "taken" : "code",
        );
      }
    },
    [linkWithCode, onLinked],
  );

  return { state, pendingEmail, open, cancel, submitEmail, submitCode };
}
