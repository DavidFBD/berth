import { normalizeAddress, type WalletFamily } from "@/lib/identity/caip";

/**
 * Whether a buy's payer can earn XP, before the buy (the deposit drawer).
 * The server proves a buy the account's only from a wallet linked to it
 * before the buy (lib/server/pour-ownership), so:
 * - an EVM payer is the session's signer, judged by the drawer as before;
 * - a Solana or Bitcoin payer not on the account is asked to be added
 *   first (Sign-In With Solana, BIP-322), the existing add a wallet flow;
 * - a network no wallet can be linked in (Sui, Stellar, NEAR, Injective,
 *   ICON, Stacks): the buy is recorded, delivered to the account, and
 *   earns no XP, which the drawer says plainly.
 * Pure, so the rule is testable without a wallet.
 */
export type PayerLink =
  | { state: "evm" }
  | { state: "linked" }
  /** Linkable, not on the account: add it first. */
  | { state: "unlinked"; family: Exclude<WalletFamily, "evm"> }
  /** No wallet of this network can be linked: recorded, no XP. */
  | { state: "unlinkable" }
  /** The account's list has not answered: never block on it. */
  | { state: "unknown" };

const LINKABLE_NETWORKS: Record<string, Exclude<WalletFamily, "evm">> = { SOLANA: "solana", BITCOIN: "bitcoin" };

export function payerLink({
  chainType,
  address,
  linked,
}: {
  /** The SDK's chain type of the paying chain (getChainType). */
  chainType: string;
  address: string | undefined;
  /** The account's wallets (GET /api/account/wallets), or undefined while unknown. */
  linked: readonly { family: string; address: string }[] | undefined;
}): PayerLink {
  if (chainType === "EVM") return { state: "evm" };
  const family = LINKABLE_NETWORKS[chainType];
  if (!family) return { state: "unlinkable" };
  if (!linked || !address) return { state: "unknown" };
  const key = normalizeAddress(family, address);
  if (!key) return { state: "unknown" };
  return linked.some((wallet) => wallet.family === family && wallet.address === key) ? { state: "linked" } : { state: "unlinked", family };
}
