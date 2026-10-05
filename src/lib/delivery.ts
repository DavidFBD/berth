import { getAddress, isAddress, type Address } from "viem";

/**
 * Where a buy is delivered (docs/plans/2026-10-05-robinhood-chain-delivery).
 *
 * Every buy so far lands on the Sonic hub, in the hub wallet SODAX derives
 * for the person. An account on the Robinhood Chain switch
 * (ROBINHOOD_DELIVERY_USERS, lib/server/delivery) instead has a new buy
 * delivered as the native Robinhood token to its own EVM wallet on
 * Robinhood Chain (chain 4663, SDK key `robinhood`). Holdings already on
 * the hub stay there and sell exactly as before.
 *
 * Pure and client safe: the route (app/api/delivery) reads the switch, the
 * wallet and the country and asks this one question. Anything unknown or
 * missing answers the hub, today's path, so a wrong guess can only ever
 * deliver where every buy has always gone.
 */

/**
 * Where Robinhood does not offer its tokens (decision 3 of the plan, David,
 * 2026-10-05): the United Kingdom, Canada and Switzerland. Accounts there
 * keep hub delivery even when switched on. The United States is not listed
 * because Berth takes no new buy there at all (lib/availability).
 */
export const ROBINHOOD_RESTRICTED_COUNTRIES: ReadonlySet<string> = new Set(["GB", "CA", "CH"]);

export type Delivery =
  /** The hub, as today: the SDK derives the hub wallet, so no address is named here. */
  | { chainKey: "sonic"; address: null }
  /** The person's own EVM wallet on Robinhood Chain, checksummed for the SDK. */
  | { chainKey: "robinhood"; address: Address };

export const HUB_DELIVERY: Delivery = { chainKey: "sonic", address: null };

/**
 * The answer for one account. `switched` is the switch for this account,
 * `evmAddress` the EVM wallet a delivery would go to (its home), `country`
 * the ISO 3166-1 alpha-2 code the request came from. An unknown country is
 * not a guess in anyone's favour: it stays on the hub.
 */
export function deliveryFor({
  switched,
  evmAddress,
  country,
}: {
  switched: boolean;
  evmAddress: string | null | undefined;
  country: string | null | undefined;
}): Delivery {
  if (!switched) return HUB_DELIVERY;
  const address = (evmAddress ?? "").trim();
  if (!isAddress(address, { strict: false })) return HUB_DELIVERY;
  const cc = (country ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc) || ROBINHOOD_RESTRICTED_COUNTRIES.has(cc)) return HUB_DELIVERY;
  return { chainKey: "robinhood", address: getAddress(address) };
}
