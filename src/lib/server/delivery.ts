import { ChainKeys } from "@sodax/sdk";
import { switchedOn } from "@/lib/limit-orders";
import { hubDelivery, type Delivery } from "@/lib/delivery";
import { ROUTE_READ, hubRpc } from "@/lib/server/hub-rpc";
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
 * Whether `address` is a plain key: no contract code at it on Robinhood
 * Chain (4663) nor on Sonic, where a wallet session's SIWE was signed.
 * A smart account (a Safe, an ERC-1271 wallet) usually has no contract at
 * the same address on Robinhood Chain, so a delivery there would land
 * where nobody can move it; any code at all, on either chain (an EIP-7702
 * delegation included), is a no. So is any failed or empty read: the
 * caller then answers the hub. A counterfactual ERC-6492 account that is
 * deployed nowhere yet reads as plain here; the proof kind recorded at
 * sign in is what can tell it apart (plan, carried into P2a).
 */
export async function isPlainKey(
  address: string,
  { fetcher = fetch }: { fetcher?: typeof fetch } = {},
): Promise<boolean> {
  const reads = await Promise.all(
    CODE_CHAINS.map((urls) => hubRpc<string>("eth_getCode", [address, "latest"], { ...ROUTE_READ, urls, fetcher })),
  );
  return reads.every((read) => read.ok && typeof read.result === "string" && /^0x0*$/i.test(read.result));
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
