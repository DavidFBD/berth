/**
 * What a wallet visitor's header shows beside the wallet pill.
 *
 * Connected is not signed in. A wallet becomes an account in this browser
 * only through the free sign in signature (hooks/use-wallet-session), and
 * until then no account read can answer: no rank, no avatar, no drawer.
 * The load asks for that signature once on its own, but a prompt that was
 * dismissed, or that the wallet never surfaced, used to leave the header
 * with the address pill alone, which reads as signed in while the account
 * stays shut and nothing offers the way in (2026-10-11, after a sign out
 * left a connected extension behind).
 *
 * - `account`: the profile answered. The rank chip, as always.
 * - `signing`: the signature is being asked for right now.
 * - `sign-in`: a wallet with no session here. A plain Sign in pill that
 *   asks for the signature, from a tap.
 * - `none`: nothing beside the pill. No wallet; a wallet waiting on the
 *   signed in or add choice, which the home's own line carries (components/
 *   account-wallets UnlinkedWalletPrompt); or a session that is loading, or
 *   whose read failed for a reason a signature would not fix.
 */
export type HeaderAccountState = "account" | "signing" | "sign-in" | "none";

export function headerAccountState(input: {
  /** The profile has answered for this identity. */
  hasProfile: boolean;
  /** The address the identity speaks for, if any (useIdentity). */
  wallet: string | null;
  /** A connected address waiting on the signed in or add choice. */
  pending: string | null;
  /** A fresh sign in session is pocketed for `wallet`. */
  hasSession: boolean;
  /** The profile read is in flight. */
  fetching: boolean;
}): HeaderAccountState {
  if (input.hasProfile) return "account";
  if (!input.wallet || input.pending) return "none";
  if (input.hasSession) return "none";
  return input.fetching ? "signing" : "sign-in";
}
