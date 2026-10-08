import { NextResponse, type NextRequest } from "next/server";
import type { Delivery } from "@/lib/delivery";
import { requestCountry } from "@/lib/server/availability";
import { decideDelivery } from "@/lib/server/delivery";
import { readRewardsCaller, resolveRewardsUser } from "@/lib/server/rewards-route";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

/**
 * Where the signed-in account's next buy is delivered (lib/delivery),
 * behind the ROBINHOOD_DELIVERY switch (lib/server/delivery: unset is
 * "listed", ROBINHOOD_DELIVERY_USERS only, so it ships dark; "on" for
 * every eligible account, turned on by setting ROBINHOOD_DELIVERY=on and
 * redeploying; "off" for nobody; never for ROBINHOOD_DELIVERY_DENY).
 * One POST, no body, answered as
 *
 *   { chainKey: "robinhood", address, reason: "switched_on" }
 *       delivered to `address`, the session's own linked EVM wallet, on Robinhood Chain
 *   { chainKey: "sonic", address: null, reason }
 *       the hub, as every buy before, with a short machine code saying why
 *       (not_listed, no_new_buys, read_failed, no_evm_wallet, not_eoa,
 *       embedded_wallet, restricted_country, unknown_country)
 *
 * An account the switch leaves off gets the hub (`not_listed`) and nothing
 * else, before any further read. Otherwise the hub is still the answer where Berth takes
 * no new buy, where Robinhood does not offer its tokens
 * (ROBINHOOD_RESTRICTED_COUNTRIES), when the country is unknown, for an
 * account with no EVM wallet, for an address with contract code on
 * Robinhood Chain or Sonic (a smart account), and whenever a read fails. Same proof of
 * identity as the rewards routes: a Privy token or a wallet session.
 */
export type DeliveryResponse = Delivery;

export async function POST(request: NextRequest) {
  const read = await readRewardsCaller(request);
  if (!read.ok) return read.response;
  const resolved = await resolveRewardsUser(read.caller);
  if (!resolved.ok) return resolved.response;
  const { user } = resolved;
  // The decision itself lives in lib/server/delivery, where the order
  // record makes it again for a buy that was delivered on Robinhood Chain.
  const delivery = await decideDelivery({
    userId: user.id,
    usersWallet: user.wallet_address,
    signer: read.caller.wallet,
    availability: read.caller.availability,
    country: requestCountry(request.headers, { url: request.url }),
  });
  return NextResponse.json(delivery satisfies DeliveryResponse);
}
