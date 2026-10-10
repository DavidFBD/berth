import { getAddress, isAddress, type Address } from "viem";

/**
 * Where a buy is delivered (docs/plans/2026-10-05-robinhood-chain-delivery).
 *
 * Every buy before Robinhood Chain delivery landed on the Sonic hub, in the
 * hub wallet SODAX derives for the person. Where the switch is on
 * (ROBINHOOD_DELIVERY, lib/server/delivery: for the allow list while it
 * is unset, for every account once it is "on") a new market stock buy is
 * instead delivered as the
 * native Robinhood token to the person's own EVM wallet on Robinhood Chain
 * (chain 4663, SDK key `robinhood`), wherever every check below allows it,
 * and the hub otherwise. Holdings already on the hub stay there and sell
 * exactly as before.
 *
 * Pure and client safe: the route (app/api/delivery) reads the switch, the
 * wallet and the country and asks this one question. Anything unknown or
 * missing answers the hub, today's path, so a wrong guess can only ever
 * deliver where every buy has always gone.
 */

/**
 * Where an account still gets hub delivery: the United Kingdom,
 * Canada and Switzerland (decision 3 of the plan, David, 2026-10-05), and
 * the Crown Dependencies, Jersey, Guernsey and the Isle of Man, which the
 * edge reports under their own codes rather than GB. The source is the
 * plan's play-safe reading of where Robinhood does not offer its tokens,
 * not a verified list from Robinhood's terms; widen it, never narrow it,
 * until those terms are read. The United States is not listed because
 * Berth takes no new buy there at all (lib/availability).
 */
export const ROBINHOOD_RESTRICTED_COUNTRIES: ReadonlySet<string> = new Set(["GB", "CA", "CH", "JE", "GG", "IM"]);

/**
 * Two letter codes a geo provider uses for "no one country": unknown (XX,
 * ZZ), Tor (T1), a region (EU, AP), an anonymous proxy or satellite (A1,
 * A2), other (O1). Each counts as an unknown country, so the hub.
 */
export const PSEUDO_COUNTRY_CODES: ReadonlySet<string> = new Set(["XX", "ZZ", "T1", "EU", "AP", "A1", "A2", "O1"]);

/**
 * Why the answer is what it is, a short machine code for the route's
 * caller (never shown as is): `switched_on` is the one Robinhood Chain
 * answer; every other code is the hub. `not_listed` is the switch itself
 * leaving the account off: the kill switch, the deny list, or listed mode
 * without the account.
 */
export type DeliveryReason =
  | "switched_on"
  | "not_listed"
  | "no_new_buys"
  | "read_failed"
  | "no_evm_wallet"
  | "not_eoa"
  /** A Privy email wallet, on a deploy where Privy does not sponsor Robinhood Chain (lib/server/delivery embeddedEligible). */
  | "embedded_wallet"
  | "restricted_country"
  | "unknown_country";

export type Delivery =
  /** The hub, as today: the SDK derives the hub wallet, so no address is named here. */
  | { chainKey: "sonic"; address: null; reason: Exclude<DeliveryReason, "switched_on"> }
  /** The person's own EVM wallet on Robinhood Chain, checksummed for the SDK. */
  | { chainKey: "robinhood"; address: Address; reason: "switched_on" };

/** The hub, and why. */
export function hubDelivery(reason: Exclude<DeliveryReason, "switched_on">): Delivery {
  return { chainKey: "sonic", address: null, reason };
}

/** A real country: two letters and no provider's pseudo code. Else null. */
export function knownCountry(country: string | null | undefined): string | null {
  const cc = (country ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(cc) && !PSEUDO_COUNTRY_CODES.has(cc) ? cc : null;
}

/**
 * The answer for one account, before the chain is asked whether the
 * address is a plain key (lib/server/delivery). `switched` is the switch
 * for this account, `evmAddress` the EVM wallet a delivery would go to,
 * `country` the ISO 3166-1 alpha-2 code the request came from. An unknown
 * country is not a guess in anyone's favour: it stays on the hub.
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
  if (!switched) return hubDelivery("not_listed");
  const address = (evmAddress ?? "").trim();
  if (!isAddress(address, { strict: false })) return hubDelivery("no_evm_wallet");
  const cc = knownCountry(country);
  if (!cc) return hubDelivery("unknown_country");
  if (ROBINHOOD_RESTRICTED_COUNTRIES.has(cc)) return hubDelivery("restricted_country");
  return { chainKey: "robinhood", address: getAddress(address), reason: "switched_on" };
}
