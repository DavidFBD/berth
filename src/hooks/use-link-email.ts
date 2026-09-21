"use client";

import { useCallback, useState } from "react";
import { getAddress } from "viem";
import { useLinkAccount, useLoginWithSiwe } from "@privy-io/react-auth";
import { useXSignMessage } from "@sodax/wallet-sdk-react";
import { HOME_CHAIN } from "@/lib/account";
import { usePrivyEmbeddedWallet } from "@/hooks/use-privy-evm-wallet";

/**
 * Putting an email on a wallet account, in the one order that does not move
 * the account.
 *
 * The previous attempt at this called `privy.login`, which is the sign-in
 * flow, and it was removed after it signed a user into a stranger's account
 * (see the note in rewards-panel and the round in thoughts.md). The failure
 * was not the button. It was the order of operations.
 *
 * `lib/account` gives the money account to whichever address wins on the
 * home chain, and an email session wins there whenever a Privy EMBEDDED
 * wallet exists. So the rule is simply: never let one be created. Signing in
 * with email mints one, which moves the account off the wallet the user
 * connected and leaves their holdings somewhere they cannot see. Signing in
 * with the WALLET does not, because `createOnLogin` is
 * "users-without-wallets" and this user has one. The Privy session then
 * exists, anchored to the very address that already owned the account, and
 * an email can be linked onto it with nothing moving.
 *
 * So: SIWE first, email second. Three steps, in this order, always.
 *   1. Privy mints a SIWE message for the connected address.
 *   2. The wallet signs it, through the same `useXSignMessage` the rewards
 *      session already uses, so no new signing path enters the app.
 *   3. `linkEmail` opens Privy's own modal on top of the new session.
 *
 * The server needs nothing: the claim path in lib/server/accounts sees a DID
 * arriving with a wallet, attaches it to the existing row, reads the email
 * off Privy and pays `email_linked` once.
 *
 * Bound to Base because that is HOME_CHAIN and therefore the chain the
 * account is a function of. Nothing is sent, so no chain switch is needed;
 * the id only binds the session in the message text.
 */

export type LinkEmailState =
  | "idle"
  /** Waiting for the wallet to sign Privy's message. */
  | "signing"
  /** Privy's email modal is open. */
  | "linking"
  | "done"
  /** The email already belongs to a different Privy account. */
  | "taken"
  | "failed";

const BASE_CHAIN_ID = 8453;

export function useLinkEmail({ onLinked }: { onLinked?: () => void } = {}): {
  state: LinkEmailState;
  start: (address: string) => Promise<void>;
  reset: () => void;
} {
  const privy = usePrivyEmbeddedWallet();
  const [state, setState] = useState<LinkEmailState>("idle");
  const { generateSiweMessage, loginWithSiwe } = useLoginWithSiwe();
  const { mutateAsync: sign } = useXSignMessage();

  const { linkEmail } = useLinkAccount({
    onSuccess: () => {
      setState("done");
      // The row only learns it has an email on the next sync, which is also
      // where the XP ceremony is played.
      onLinked?.();
    },
    onError: (error) => {
      // The honest version of the bug this replaced: the address belongs to
      // somebody else's Privy account, and the only truthful thing to do is
      // say so rather than quietly become them.
      setState(error === "linked_to_another_user" ? "taken" : "failed");
    },
  });

  const start = useCallback(
    async (address: string) => {
      if (!privy.enabled || !privy.ready) return;
      setState("signing");
      try {
        // An already-authenticated session needs no SIWE step; this is the
        // user who connected a wallet and then came back.
        if (!privy.authenticated) {
          const message = await generateSiweMessage({
            address: getAddress(address),
            chainId: `eip155:${BASE_CHAIN_ID}`,
          });
          const signature = await sign({ xChainType: "EVM", message });
          if (typeof signature !== "string" || !signature.startsWith("0x")) {
            setState("idle");
            return;
          }
          await loginWithSiwe({ message, signature });
        }
        setState("linking");
        linkEmail();
      } catch {
        // A declined signature is the common case and is not a failure: the
        // user changed their mind and the panel should look untouched.
        setState("idle");
      }
    },
    [
      privy.enabled,
      privy.ready,
      privy.authenticated,
      generateSiweMessage,
      sign,
      loginWithSiwe,
      linkEmail,
    ],
  );

  const reset = useCallback(() => setState("idle"), []);

  return { state, start, reset };
}

/** The chain the SIWE session is bound to, exported for the test. */
export const LINK_EMAIL_CHAIN = HOME_CHAIN;
