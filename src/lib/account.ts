import { isEvmChainKeyType, type SpokeChainKey } from "@sodax/sdk";

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
