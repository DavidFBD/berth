import { getAddress, isAddress, type Address } from "viem";
import type { Listing } from "@/lib/listings";

/**
 * What an account holds on two chains (plan P1a): the hub on Sonic, as
 * every holding has always been read (hooks/use-hub-holdings), and, for any
 * account with an EVM wallet, the native Robinhood tokens in its own EVM
 * wallets on Robinhood Chain (chain 4663), where buys are delivered by
 * default.
 *
 * One row per listing, summed, with where each part sits. This is for
 * showing and valuing only. Anything that spends (a sell, a limit sell,
 * their Max, the assistant's sell cap) reads the hub alone, never `balance`
 * here: a hub sell cannot spend what sits on Robinhood Chain.
 */

/** Where the Robinhood Chain read stands: off (no EVM wallet), loading, read, or failed (unknown, shown as nothing, never as zero). */
export type RobinhoodReadState = "off" | "loading" | "read" | "failed";

export type AccountHolding = {
  listing: Listing;
  /** Everything held of the listing that was read: `hub` plus `robinhood`. */
  balance: bigint;
  /** On the hub, in the Berth account: the only part a sell spends. */
  hub: bigint;
  /** In the person's own wallet on Robinhood Chain; 0 when unread or off. */
  robinhood: bigint;
};

/**
 * The two reads as one list, in the hub's order. `robinhood` is the
 * per-listing totals in the same order, or undefined when that read is not
 * in (off, loading, failed): the rows are then the hub's alone, so a failed
 * read can only ever show less, marked as unread by the caller, and never a
 * Robinhood Chain zero as fact.
 */
export function mergeChainHoldings(
  hub: readonly { listing: Listing; balance: bigint }[],
  robinhood: readonly bigint[] | undefined,
): AccountHolding[] {
  return hub.map((holding, index) => {
    const onRobinhood = robinhood?.[index] ?? 0n;
    return { listing: holding.listing, balance: holding.balance + onRobinhood, hub: holding.balance, robinhood: onRobinhood };
  });
}

/** Only what is held somewhere. */
export function heldOnly<T extends { balance: bigint }>(holdings: readonly T[]): T[] {
  return holdings.filter((holding) => holding.balance > 0n);
}

/**
 * The account's EVM wallets on Robinhood Chain: every linked EVM address
 * (the addresses its hub wallets derive from) and the session's signer,
 * checksummed, once each. Anything not an EVM address is left out.
 */
export function robinhoodOwners(account: {
  wallets: readonly { spoke: string }[];
  signerSpoke?: string | undefined;
}): Address[] {
  const seen = new Set<string>();
  const owners: Address[] = [];
  for (const spoke of [...account.wallets.map((wallet) => wallet.spoke), account.signerSpoke]) {
    if (!spoke || !isAddress(spoke, { strict: false })) continue;
    const owner = getAddress(spoke);
    if (seen.has(owner)) continue;
    seen.add(owner);
    owners.push(owner);
  }
  return owners;
}

/** One Robinhood Chain read: whose wallets, and which tokens (with their place in the hub's list). */
export type RobinhoodReadPlan = {
  owners: Address[];
  tokens: { rhAddress: Address; index: number }[];
};

/**
 * Whether to read Robinhood Chain at all, and what. Null, so no client is
 * built and no call is made, unless the account has an EVM wallet and some
 * listing has a token there. Not tied to the delivery switch: delivery is
 * on by default, and a switch turned off later (the kill switch, the deny
 * list) must never hide what was delivered before it. Stocks
 * and funds only: cash (SGOV) is parked and unparked on the hub, and only a
 * stock buy is delivered to Robinhood Chain (lib/delivery-client).
 */
export function robinhoodReadPlan({
  account,
  listings,
}: {
  account: Parameters<typeof robinhoodOwners>[0];
  listings: readonly Listing[];
}): RobinhoodReadPlan | null {
  const owners = robinhoodOwners(account);
  const tokens = listings.flatMap((listing, index) =>
    listing.kind === "stock" && listing.rhAddress ? [{ rhAddress: listing.rhAddress, index }] : [],
  );
  return owners.length > 0 && tokens.length > 0 ? { owners, tokens } : null;
}

/** The read's totals (in plan order) placed back at their listings, zero elsewhere. */
export function placeRobinhoodTotals(plan: RobinhoodReadPlan, totals: readonly bigint[], listingCount: number): bigint[] {
  const byIndex = Array.from({ length: listingCount }, () => 0n);
  plan.tokens.forEach((token, position) => {
    byIndex[token.index] = totals[position] ?? 0n;
  });
  return byIndex;
}
