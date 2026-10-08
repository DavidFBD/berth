import { getAddress, isAddress, type Address } from "viem";
import type { Listing } from "@/lib/listings";

/**
 * What an account holds on two chains (plan P1a): the hub on Sonic, as
 * every holding has always been read (hooks/use-hub-holdings), and, for any
 * account with an EVM wallet, the native Robinhood tokens in its own EVM
 * wallets on Robinhood Chain (chain 4663), where buys are delivered while
 * the switch (ROBINHOOD_DELIVERY) lets them.
 *
 * One row per listing, summed, with where each part sits. This is for
 * showing and valuing, and for whether there is anything to sell at all.
 * Nothing sizes an order from `balance` here: a sell spends one place at a
 * time (plan P3a), a hub wallet or one wallet on Robinhood Chain, each read
 * on its own (components/home SellHost, hooks/use-robinhood-sell), and a
 * limit sell spends the hub alone.
 */

/** Where the Robinhood Chain read stands: off (no EVM wallet), loading, read, or failed (unknown, shown as nothing, never as zero). */
export type RobinhoodReadState = "off" | "loading" | "read" | "failed";

export type AccountHolding = {
  listing: Listing;
  /** Everything held of the listing that was read: `hub` plus `robinhood` plus `returned`. */
  balance: bigint;
  /** On the hub, in the Berth account: what a sell from the account spends. */
  hub: bigint;
  /** In the person's own wallet on Robinhood Chain; 0 when unread or off. */
  robinhood: bigint;
  /**
   * Back on Sonic from a sell from Robinhood Chain that did not fill, in the
   * hub wallet derived for (robinhood, the wallet) (lib/robinhood-returned).
   * Counted and shown; no sell in Berth spends it. 0 when unread or none.
   */
  returned: bigint;
  /** What a sell can spend, one place at a time: `hub` plus `robinhood`, never `returned`. */
  sellable: bigint;
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
  returned?: readonly bigint[],
): AccountHolding[] {
  return hub.map((holding, index) => {
    const onRobinhood = robinhood?.[index] ?? 0n;
    const back = returned?.[index] ?? 0n;
    return {
      listing: holding.listing,
      balance: holding.balance + onRobinhood + back,
      hub: holding.balance,
      robinhood: onRobinhood,
      returned: back,
      sellable: holding.balance + onRobinhood,
    };
  });
}

/**
 * What came back to Sonic from sells from Robinhood Chain (raw amounts by
 * symbol, lib/robinhood-returned), placed at each stock listing in the
 * hub's order, zero elsewhere.
 */
export function placeReturnedTotals(listings: readonly Listing[], total: ReadonlyMap<string, bigint>): bigint[] {
  return listings.map((listing) => (listing.kind === "stock" ? (total.get(listing.symbol) ?? 0n) : 0n));
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
 * listing has a token there. The route then says whether this account's
 * side is read at all (lib/server/portfolio robinhoodReads, in
 * hooks/use-account-holdings): yes for any account with an order or a
 * holding there, so a switch narrowed or turned off later (the allow list,
 * the kill switch, the deny list) never hides what was delivered before it. Stocks
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
