import { ChainKeys } from "@sodax/sdk";
import { AVAILABLE, type Availability } from "@/lib/availability";
import { switchedOn } from "@/lib/limit-orders";
import { deliveryFor, hubDelivery, type Delivery, type DeliveryReason } from "@/lib/delivery";
import { ROUTE_READ, hubRpc } from "@/lib/server/hub-rpc";
import { accountEvmAddresses } from "@/lib/server/identities";
import { HUB_RPC_URLS, getPinnedRpcUrls } from "@/lib/sodax-config";

/**
 * The Robinhood Chain delivery switch: `ROBINHOOD_DELIVERY_USERS`, a comma
 * separated list of Berth user ids or wallet addresses (lib/limit-orders
 * switchedOn, the same reading as LIMIT_ORDERS_USERS). Unset or empty
 * switches nobody on, which is how it ships: every buy then delivers to the
 * hub exactly as before. Read server side on every call and never through a
 * NEXT_PUBLIC_ variable; the browser learns its own answer from
 * app/api/delivery and nothing about anyone else.
 */
export function robinhoodDeliveryOn(identifiers: readonly (string | null | undefined)[]): boolean {
  return switchedOn(process.env.ROBINHOOD_DELIVERY_USERS, identifiers);
}

/** The chains a destination is asked about: Robinhood Chain itself, and Sonic, the one chain every Berth SIWE names. */
const CODE_CHAINS: readonly (readonly string[])[] = [getPinnedRpcUrls(ChainKeys.ROBINHOOD_MAINNET), HUB_RPC_URLS];

/**
 * EIP-7702 delegates whose designator (`0xef0100 || delegate`) still counts
 * as a plain key. 0xd6cedde84be40893d153be9d467cd6ad37875b28 is Privy's
 * EIP-7702 implementation, installed by a sponsored send; read live on Base,
 * Sonic and Robinhood Chain (4663) on 2026-10-05. Lowercase; add a delegate
 * only after reading its code on 4663 and on Sonic.
 */
export const KNOWN_7702_DELEGATES: ReadonlySet<string> = new Set(["0xd6cedde84be40893d153be9d467cd6ad37875b28"]);

/** No code, or exactly 23 bytes `0xef0100 || delegate` with a pinned delegate. */
function isPlainCode(code: string): boolean {
  if (/^0x0*$/i.test(code)) return true;
  const designator = /^0xef0100([0-9a-f]{40})$/i.exec(code);
  return designator !== null && KNOWN_7702_DELEGATES.has(`0x${designator[1].toLowerCase()}`);
}

/**
 * Whether `address` is a plain key: no contract code at it on Robinhood
 * Chain (4663) nor on Sonic, where a wallet session's SIWE was signed.
 * A smart account (a Safe, an ERC-1271 wallet) usually has no contract at
 * the same address on Robinhood Chain, so a delivery there would land
 * where nobody can move it; any contract code, on either chain, is a no.
 * An EIP-7702 delegation to a pinned delegate (KNOWN_7702_DELEGATES) is
 * still a plain key: its key controls the address on every chain. A
 * designator to any other delegate is a no, and so is any failed or empty
 * read: the caller then answers the hub. A counterfactual ERC-6492 account that is
 * deployed nowhere yet reads as plain here; the proof kind recorded at
 * sign in is what can tell it apart (plan, carried into P2a).
 */
export async function isPlainKey(
  address: string,
  options: { fetcher?: typeof fetch } = {},
): Promise<boolean> {
  return (await readPlainKey(address, options)) === true;
}

/**
 * isPlainKey, telling a "no" apart from a read that did not answer:
 * false when either chain shows code that is not plain, "unknown" when a
 * chain could not be read (and none showed such code), true only when both
 * answered plain. The order record needs the difference (a read that fails
 * there is asked again later, never held against the order); the route
 * answers the hub for both.
 */
export async function readPlainKey(
  address: string,
  { fetcher = fetch }: { fetcher?: typeof fetch } = {},
): Promise<boolean | "unknown"> {
  const reads = await Promise.all(
    CODE_CHAINS.map((urls) => hubRpc<string>("eth_getCode", [address, "latest"], { ...ROUTE_READ, urls, fetcher })),
  );
  if (reads.some((read) => read.ok && typeof read.result === "string" && !isPlainCode(read.result))) return false;
  return reads.every((read) => read.ok && typeof read.result === "string") ? true : "unknown";
}

/**
 * The last step before a Robinhood Chain answer: the address must be a
 * plain key, or the answer is the hub (`not_eoa`). A hub answer passes
 * through untouched, with no chain read.
 */
export async function confirmPlainKey(delivery: Delivery, options: { fetcher?: typeof fetch } = {}): Promise<Delivery> {
  if (delivery.chainKey !== "robinhood") return delivery;
  return (await isPlainKey(delivery.address, options)) ? delivery : hubDelivery("not_eoa");
}

/** What the delivery decision is made from: the account, the wallet this session signs with, where the request came from. */
export type DeliveryInputs = {
  userId: string;
  /** users.wallet_address, the account's home. */
  usersWallet: string | null;
  /** The wallet the session signs with (the rewards caller's `wallet`). */
  signer: string | null | undefined;
  /** Where Berth takes new buys (the caller's availability); absent reads as available, as the route reads it. */
  availability: Availability | undefined;
  /** The request's country (lib/server/availability requestCountry). */
  country: string | null;
  fetcher?: typeof fetch;
};

/**
 * The one decision where an account's next buy is delivered (plan P2a: the
 * route's answer and the order record's re-check are this same function).
 * Everyone not switched on gets the hub before any further read. Switched
 * on, the hub is still the answer where Berth takes no new buy, where
 * Robinhood does not offer its tokens (lib/delivery), when the country is
 * unknown, for a session not signing with one of the account's own linked
 * EVM wallets, for an address with code on Robinhood Chain or Sonic, and
 * whenever a read fails. `unread` says a read failed rather than answered
 * no, which only the re-check acts on.
 */
async function decide(inputs: DeliveryInputs): Promise<{ delivery: Delivery; unread: boolean }> {
  const { userId, usersWallet, signer, availability, country, fetcher } = inputs;
  if (!robinhoodDeliveryOn([userId, usersWallet, signer])) return { delivery: hubDelivery("not_listed"), unread: false };
  // Where Berth takes no new buy, a buy is not on offer to deliver anywhere.
  if (!(availability ?? AVAILABLE).available) return { delivery: hubDelivery("no_new_buys"), unread: false };
  // The wallet this session signs with, and only when it is one of the
  // account's own linked EVM wallets. Not the home wallet when the two
  // differ: a sell of what lands on Robinhood Chain (plan P3a) must be
  // signed there by the wallet that holds it, and the one wallet this
  // session is known to sign with is its own. Anything else (a Solana or
  // Bitcoin session, a wallet the account does not hold) answers the hub.
  // A failed read of the account's wallets is the hub too, never a guess.
  let evmAddress: string | null = null;
  try {
    const { all } = await accountEvmAddresses(userId, usersWallet, { failClosed: true });
    const own = (signer ?? "").toLowerCase();
    evmAddress = own && all.includes(own) ? own : null;
  } catch {
    return { delivery: hubDelivery("read_failed"), unread: true };
  }
  const delivery = deliveryFor({ switched: true, evmAddress, country });
  if (delivery.chainKey !== "robinhood") return { delivery, unread: false };
  // Only a plain key on Robinhood Chain and on Sonic: a smart account's
  // address there may be nobody's (isPlainKey).
  const plain = await readPlainKey(delivery.address, { fetcher });
  return plain === true ? { delivery, unread: false } : { delivery: hubDelivery("not_eoa"), unread: plain === "unknown" };
}

/** The delivery for the next buy, as app/api/delivery answers it. */
export async function decideDelivery(inputs: DeliveryInputs): Promise<Delivery> {
  return (await decide(inputs)).delivery;
}

/**
 * The server's own check of a buy that was delivered on Robinhood Chain,
 * when the order is recorded (plan, carried into P2a). The route's answer
 * is advice and the intent is built and signed in the browser, so the
 * same decision is made again from this request: the buy is allowed only
 * when today's answer is Robinhood Chain to exactly the address it was
 * delivered to. `refused` says why (a hub reason, or `other_address` for
 * a delivery to any other wallet); `unknown` is a read that did not
 * answer, asked again later and never held against the order.
 */
export type DestinationCheck =
  | { verdict: "allowed" }
  | { verdict: "refused"; reason: Exclude<DeliveryReason, "switched_on" | "read_failed"> | "other_address" }
  | { verdict: "unknown" };

export async function recheckRobinhoodDestination(inputs: DeliveryInputs & { dstAddress: string }): Promise<DestinationCheck> {
  const { delivery, unread } = await decide(inputs);
  if (unread) return { verdict: "unknown" };
  if (delivery.chainKey === "robinhood") {
    return delivery.address.toLowerCase() === inputs.dstAddress.toLowerCase()
      ? { verdict: "allowed" }
      : { verdict: "refused", reason: "other_address" };
  }
  // read_failed always comes with unread, so it never reaches here.
  return { verdict: "refused", reason: delivery.reason as Exclude<DeliveryReason, "switched_on" | "read_failed"> };
}
