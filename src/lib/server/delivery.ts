import { ChainKeys } from "@sodax/sdk";
import { isAddress } from "viem";
import { AVAILABLE, type Availability } from "@/lib/availability";
import { switchedOn } from "@/lib/limit-orders";
import { ROBINHOOD_RESTRICTED_COUNTRIES, deliveryFor, hubDelivery, knownCountry, type Delivery, type DeliveryReason } from "@/lib/delivery";
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
 * order record's re-check, recheckRobinhoodDestination, makes the same
 * checks, split so the evening pass can rerun the part a request is not
 * needed for).
 * Everyone not switched on gets the hub before any further read. Switched
 * on, the hub is still the answer where Berth takes no new buy, where
 * Robinhood does not offer its tokens (lib/delivery), when the country is
 * unknown, for a session not signing with one of the account's own linked
 * EVM wallets, for an address with code on Robinhood Chain or Sonic, and
 * whenever a read fails.
 */
async function decide(inputs: DeliveryInputs): Promise<Delivery> {
  const { userId, usersWallet, signer, availability, country, fetcher } = inputs;
  if (!robinhoodDeliveryOn([userId, usersWallet, signer])) return hubDelivery("not_listed");
  // Where Berth takes no new buy, a buy is not on offer to deliver anywhere.
  if (!(availability ?? AVAILABLE).available) return hubDelivery("no_new_buys");
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
    return hubDelivery("read_failed");
  }
  const delivery = deliveryFor({ switched: true, evmAddress, country });
  if (delivery.chainKey !== "robinhood") return delivery;
  // Only a plain key on Robinhood Chain and on Sonic: a smart account's
  // address there may be nobody's (isPlainKey).
  return (await readPlainKey(delivery.address, { fetcher })) === true ? delivery : hubDelivery("not_eoa");
}

/** The delivery for the next buy, as app/api/delivery answers it. */
export async function decideDelivery(inputs: DeliveryInputs): Promise<Delivery> {
  return decide(inputs);
}

/**
 * The server's own check of a buy that was delivered on Robinhood Chain,
 * when the order is recorded (plan, carried into P2a). The route's answer
 * is advice and the intent is built and signed in the browser, so the
 * same decision is made again: the buy is allowed only when it answers
 * Robinhood Chain to exactly the address it was delivered to. `refused`
 * says why (a hub reason, `other_address` for a delivery to any other
 * wallet, `place_at_report` when the place stored at report time said
 * no); `unknown` is a read that did not answer, asked again later and
 * never held against the order.
 */
export type DestinationCheck =
  | { verdict: "allowed" }
  | { verdict: "refused"; reason: Exclude<DeliveryReason, "switched_on" | "read_failed"> | "other_address" | DeliveryPlaceRefusal }
  | { verdict: "unknown" };

/** Why the place said no: the switch, where Berth takes buys, the country; or, rerun from a claim, the stored "no". */
export type DeliveryPlaceRefusal = "not_listed" | "no_new_buys" | "unknown_country" | "restricted_country" | "place_at_report";

/**
 * The half of the decision only the reporting request can answer: the
 * switch, whether Berth takes new buys there, and whether Robinhood offers
 * its tokens in that country. Pure (the switch is an environment read), so
 * the pour route stores its outcome on the claim (pour_claims
 * delivery_place_ok) as a yes or no, never the country (the privacy
 * policy), and the evening pass reruns the rest of the decision from it.
 * Stored at report time, so a switch edited while a claim waits changes
 * nothing for that claim.
 */
export type DeliveryPlace = { ok: true } | { ok: false; reason: DeliveryPlaceRefusal };

export function deliveryPlace({
  userId,
  usersWallet,
  signer,
  availability,
  country,
}: Pick<DeliveryInputs, "userId" | "usersWallet" | "signer" | "availability" | "country">): DeliveryPlace {
  if (!robinhoodDeliveryOn([userId, usersWallet, signer])) return { ok: false, reason: "not_listed" };
  if (!(availability ?? AVAILABLE).available) return { ok: false, reason: "no_new_buys" };
  const cc = knownCountry(country);
  if (!cc) return { ok: false, reason: "unknown_country" };
  if (ROBINHOOD_RESTRICTED_COUNTRIES.has(cc)) return { ok: false, reason: "restricted_country" };
  return { ok: true };
}

/**
 * The rest of the decision, from the place and the signing wallet alone,
 * so the evening pass can rerun it from what the claim stored: the signer
 * must be one of the account's own linked EVM wallets today, the buy
 * delivered to exactly it, and it a plain key on Robinhood Chain and on
 * Sonic (readPlainKey). A failed read is `unknown`, never a refusal.
 */
export async function recheckDestination({
  userId,
  usersWallet,
  signer,
  place,
  dstAddress,
  fetcher,
}: {
  userId: string;
  usersWallet: string | null;
  signer: string | null | undefined;
  place: DeliveryPlace;
  dstAddress: string;
  fetcher?: typeof fetch;
}): Promise<DestinationCheck> {
  if (!place.ok) return { verdict: "refused", reason: place.reason };
  const own = (signer ?? "").toLowerCase();
  if (!own || !isAddress(own, { strict: false })) return { verdict: "refused", reason: "no_evm_wallet" };
  let all: string[];
  try {
    ({ all } = await accountEvmAddresses(userId, usersWallet, { failClosed: true }));
  } catch {
    return { verdict: "unknown" };
  }
  if (!all.includes(own)) return { verdict: "refused", reason: "no_evm_wallet" };
  if (own !== dstAddress.toLowerCase()) return { verdict: "refused", reason: "other_address" };
  const plain = await readPlainKey(own, { fetcher });
  if (plain === "unknown") return { verdict: "unknown" };
  return plain ? { verdict: "allowed" } : { verdict: "refused", reason: "not_eoa" };
}

/** The re-check from a reporting request: its place, then the rest (recheckDestination). */
export async function recheckRobinhoodDestination(inputs: DeliveryInputs & { dstAddress: string }): Promise<DestinationCheck> {
  return recheckDestination({ ...inputs, place: deliveryPlace(inputs) });
}
