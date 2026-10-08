import { ChainKeys } from "@sodax/sdk";
import { isAddress } from "viem";
import { AVAILABLE, type Availability } from "@/lib/availability";
import { switchedOn } from "@/lib/limit-orders";
import { ROBINHOOD_RESTRICTED_COUNTRIES, deliveryFor, hubDelivery, knownCountry, type Delivery, type DeliveryReason } from "@/lib/delivery";
import { ROUTE_READ, hubRpc } from "@/lib/server/hub-rpc";
import { accountEvmAddresses } from "@/lib/server/identities";
import { HUB_RPC_URLS, getPinnedRpcUrls } from "@/lib/sodax-config";
import { PRIVY_SPONSORABLE_CHAIN_IDS } from "@/lib/gas-sponsor";
import { getSql } from "@/lib/server/db";
import { readPrivyEmbeddedWallet } from "@/lib/server/privy";

/**
 * How the Robinhood Chain delivery switch stands, from `ROBINHOOD_DELIVERY`:
 *
 *   unset or empty  "listed": only the accounts in ROBINHOOD_DELIVERY_USERS,
 *                   the beta's allow list (empty: nobody). The code's
 *                   default is dark, so no deploy can switch delivery on by
 *                   accident.
 *   "on"            every eligible account. Turn it on by setting
 *                   ROBINHOOD_DELIVERY=on and redeploying (David,
 *                   2026-10-08: as much as can goes to Robinhood Chain,
 *                   once a sell from there exists).
 *   "listed"        as unset, said explicitly
 *   "off"           nobody: every buy delivers to the hub, as before
 *
 * Any other value reads as "off": a typo in the kill switch must never
 * widen delivery, and the hub is the path every buy has always taken.
 */
export type RobinhoodDeliveryMode = "on" | "listed" | "off";

export function robinhoodDeliveryMode(raw: string | null | undefined = process.env.ROBINHOOD_DELIVERY): RobinhoodDeliveryMode {
  const mode = (raw ?? "").trim().toLowerCase();
  if (mode === "" || mode === "listed") return "listed";
  if (mode === "on") return "on";
  return "off";
}

/**
 * Whether the switch lets an account's buys be delivered on Robinhood
 * Chain, before any of the checks that keep the rest on the hub (where
 * Berth takes buys, the country, the signing wallet, a plain key).
 * `ROBINHOOD_DELIVERY_DENY` is a comma separated list of Berth user ids or
 * wallet addresses that stay on the hub in every mode (lib/limit-orders
 * switchedOn, the same reading as LIMIT_ORDERS_USERS). Read server side on
 * every call and never through a NEXT_PUBLIC_ variable; the browser learns
 * its own answer from app/api/delivery and nothing about anyone else.
 */
export function robinhoodDeliveryOn(identifiers: readonly (string | null | undefined)[]): boolean {
  if (switchedOn(process.env.ROBINHOOD_DELIVERY_DENY, identifiers)) return false;
  const mode = robinhoodDeliveryMode();
  if (mode === "off") return false;
  if (mode === "listed") return switchedOn(process.env.ROBINHOOD_DELIVERY_USERS, identifiers);
  return true;
}

/**
 * Whether a Privy email wallet (the embedded wallet) may take delivery on
 * Robinhood Chain: only once Robinhood Chain (4663) is sponsorable
 * (lib/gas-sponsor PRIVY_SPONSORABLE_CHAIN_IDS, held out until SODAX
 * confirms its relayer picks up a sponsored 7702 send, the plan's decision
 * 2). An email wallet holds no ETH there and has no way to get any, so
 * until then it could take delivery but never sell (rh-ux-sec B1). The
 * day 4663 joins that set, email wallets become eligible with no other
 * change. External plain key wallets stay eligible either way.
 */
export function embeddedEligible(ids: ReadonlySet<number> = PRIVY_SPONSORABLE_CHAIN_IDS): boolean {
  return ids.has(4663);
}

/**
 * Whether the account's wallet `address` is its Privy email wallet: linked
 * with Privy's own proof ('privy_wallet'), or, for an email account whose
 * wallet row predates proofs ('legacy', or none yet), its home address, or
 * the embedded wallet Privy itself names for the account's DID (as the
 * wallets list asks it, rh-final 3). Throws when the tables cannot be read
 * or Privy cannot be asked: any doubt answers the hub (decide) or unknown
 * (recheckDestination), never Robinhood Chain.
 */
export async function isEmbeddedWallet(
  userId: string,
  address: string,
  readPrivy: typeof readPrivyEmbeddedWallet = readPrivyEmbeddedWallet,
): Promise<boolean> {
  const value = address.toLowerCase();
  const rows = (await getSql().query(
    `select u.privy_did,
            (i.proof = 'privy_wallet'
             or (u.privy_did is not null and lower(u.wallet_address) = $2 and coalesce(i.proof, 'legacy') = 'legacy')) as embedded
       from users u
       left join user_identities i on i.user_id = u.id and i.kind = 'wallet' and i.value = $2 and i.unlinked_at is null
      where u.id = $1`,
    [userId, value],
  )) as { privy_did: string | null; embedded: boolean | null }[];
  if (rows.some((row) => row.embedded === true)) return true;
  const did = rows.find((row) => row.privy_did)?.privy_did;
  if (!did?.startsWith("did:privy:")) return false;
  const privy = await readPrivy(did);
  if (!privy.ok) throw new Error("Privy could not be asked");
  return privy.address === value;
}

/**
 * The sell switch (rh-ux-sec M1): whether this account may start a sell
 * from its own wallet on Robinhood Chain, a new write path (an approve and
 * a spoke intent on 4663) that ROBINHOOD_DELIVERY alone does not cover.
 *
 *   ROBINHOOD_SELL=off    nobody, whatever else holds (the kill switch)
 *   ROBINHOOD_DELIVERY=on everyone (delivery is on for all, so selling is)
 *   otherwise             only an account with a Berth buy delivered to
 *                         Robinhood Chain on record (orders.holding_chain)
 *
 * So with no env change nobody without a Berth delivery there can start
 * one. Reading and showing what sits there is not affected. Any value of
 * ROBINHOOD_SELL but "off" changes nothing. A failed read is no.
 *
 * ROBINHOOD_DELIVERY_DENY is deliberately NOT read here (review, decided
 * 2026-10-08): it keeps an account's new buys on the hub, but a sell from
 * Robinhood Chain spends the person's own tokens in their own wallet, their
 * way out of what was delivered before the deny. Closing it would strand
 * them; ROBINHOOD_SELL=off stays the one switch that stops every sell.
 */
export async function robinhoodSellOn(userId: string): Promise<boolean> {
  if ((process.env.ROBINHOOD_SELL ?? "").trim().toLowerCase() === "off") return false;
  if (robinhoodDeliveryMode() === "on") return true;
  try {
    const rows = (await getSql().query(
      `select exists (select 1 from orders where user_id = $1 and direction = 'buy' and holding_chain = 'robinhood') as found`,
      [userId],
    )) as { found: boolean }[];
    return rows[0]?.found === true;
  } catch {
    return false;
  }
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
  // An email wallet only once a sell from there costs it nothing (embeddedEligible).
  if (!embeddedEligible()) {
    try {
      if (await isEmbeddedWallet(userId, delivery.address)) return hubDelivery("embedded_wallet");
    } catch {
      return hubDelivery("read_failed");
    }
  }
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
  if (!embeddedEligible()) {
    try {
      if (await isEmbeddedWallet(userId, own)) return { verdict: "refused", reason: "embedded_wallet" };
    } catch {
      return { verdict: "unknown" };
    }
  }
  const plain = await readPlainKey(own, { fetcher });
  if (plain === "unknown") return { verdict: "unknown" };
  return plain ? { verdict: "allowed" } : { verdict: "refused", reason: "not_eoa" };
}

/** The re-check from a reporting request: its place, then the rest (recheckDestination). */
export async function recheckRobinhoodDestination(inputs: DeliveryInputs & { dstAddress: string }): Promise<DestinationCheck> {
  return recheckDestination({ ...inputs, place: deliveryPlace(inputs) });
}
