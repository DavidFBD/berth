import { ChainKeys, isEvmChainKeyType, type SpokeChainKey } from "@sodax/sdk";

/**
 * THE rule for whose address the user is on a given chain. It used to be
 * re-derived, slightly differently, in five modules — and the disagreements
 * were exactly where "the pour succeeded but the cup claims to await its
 * first pour" class of bug lived. Every consumer (signing, balance reads,
 * share reads, the token picker) resolves through here, so the address that
 * is read is always the address that signs.
 *
 * The rule: an email session wins on EVM chains (the Privy embedded wallet,
 * which never enters the SODAX wallet store); everywhere else the store
 * wins — including email-mode Solana, whose embedded wallet is bridged INTO
 * the store (see privy-solana-bridge).
 *
 * Deliberately NOT covered: the rewards identity in use-profile. That is a
 * session question (which ledger row is this browser), not a chain question,
 * and it must never volunteer a connected external wallet while an email
 * session is live — account linking is an explicit act, not a fallback.
 */

export type AccountSession = {
  /**
   * Signed in via email with a live embedded wallet. False while Privy is
   * still initializing the embedded wallet, so a transient session resolves
   * to the store rather than to an address that can't sign yet.
   */
  emailSession: boolean;
  /** The Privy embedded EVM address: one address, every EVM chain. */
  embeddedEvmAddress: string | undefined;
};

export type ResolvedAccount = {
  address: string | undefined;
  /** Which wallet source resolved for this chain. */
  mode: "email" | "external";
};

export function resolveAccount(
  chainKey: SpokeChainKey | null | undefined,
  session: AccountSession,
  storeAddress: string | undefined,
): ResolvedAccount {
  if (!chainKey) return { address: undefined, mode: "external" };
  if (session.emailSession && isEvmChainKeyType(chainKey)) {
    return { address: session.embeddedEvmAddress, mode: "email" };
  }
  return { address: storeAddress, mode: "external" };
}

/**
 * The home chain: the one spoke every account's shelf derives from. A hub
 * wallet is a function of (chainKey, address), so the same Privy address
 * would own a different shelf per chain; picking one chain once is what makes
 * "one account, one place to sell" true. Base, because it is the cheapest
 * EVM spoke the embedded wallet signs on, and every sell is one signature
 * there (decided 2026-09-16).
 */
export const HOME_CHAIN: SpokeChainKey = ChainKeys.BASE_MAINNET;

/**
 * The spoke address the account derives from, by the one address rule on
 * the home chain: the Privy embedded EVM address in an email session,
 * otherwise the connected EVM wallet. The address that signs on Base is the
 * address whose hub wallet is the account, whichever wallet that is. A
 * browser with only a non-EVM wallet (Phantom on Solana alone, Xverse) has
 * funds but no account until it signs in with email.
 */
export function homeSpokeAddress(
  session: AccountSession,
  connectedEvmAddress?: string,
): string | undefined {
  return resolveAccount(HOME_CHAIN, session, connectedEvmAddress).address;
}

/**
 * Whether this browser's session is a wallet that pays its own network
 * fees, known for sure (hooks/use-account useWalletOnlySession):
 * - Privy off: no email sign-in exists to compare with, so false and the
 *   email wording never shows.
 * - an email session, or Privy still answering: false, so an email session
 *   never flashes the wallet's notice.
 * - signed in to Privy with no embedded wallet once the wallets are listed
 *   (its creation failed, or a wallet signed in to Privy): true, it pays.
 */
export function isWalletOnlySession(s: {
  enabled: boolean;
  ready: boolean;
  walletsReady: boolean;
  authenticated: boolean;
  hasEmbedded: boolean;
  emailSession: boolean;
}): boolean {
  if (!s.enabled || s.emailSession || !s.ready) return false;
  if (s.authenticated && !s.hasEmbedded) return s.walletsReady;
  return true;
}
