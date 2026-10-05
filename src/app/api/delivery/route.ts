import { NextResponse, type NextRequest } from "next/server";
import { deliveryFor, hubDelivery, type Delivery } from "@/lib/delivery";
import { accountEvmAddresses } from "@/lib/server/identities";
import { AVAILABLE, requestCountry } from "@/lib/server/availability";
import { robinhoodDeliveryOn } from "@/lib/server/delivery";
import { readRewardsCaller, resolveRewardsUser } from "@/lib/server/rewards-route";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

/**
 * Where the signed-in account's next buy is delivered (lib/delivery),
 * behind the ROBINHOOD_DELIVERY_USERS switch (lib/server/delivery). One
 * POST, no body, answered as
 *
 *   { chainKey: "robinhood", address, reason: "switched_on" }
 *       delivered to `address`, the account's own EVM wallet, on Robinhood Chain
 *   { chainKey: "sonic", address: null, reason }
 *       the hub, as every buy before, with a short machine code saying why
 *       (not_listed, no_new_buys, read_failed, no_evm_wallet, not_eoa,
 *       restricted_country, unknown_country)
 *
 * Everyone not switched on gets the hub and nothing else, before any
 * further read. Switched on, the hub is still the answer where Berth takes
 * no new buy, where Robinhood does not offer its tokens
 * (ROBINHOOD_RESTRICTED_COUNTRIES), when the country is unknown, for an
 * account with no EVM wallet, and whenever a read fails. Same proof of
 * identity as the rewards routes: a Privy token or a wallet session.
 */
export type DeliveryResponse = Delivery;

export async function POST(request: NextRequest) {
  const read = await readRewardsCaller(request);
  if (!read.ok) return read.response;
  const resolved = await resolveRewardsUser(read.caller);
  if (!resolved.ok) return resolved.response;
  const { user } = resolved;

  if (!robinhoodDeliveryOn([user.id, user.wallet_address, read.caller.wallet])) {
    return NextResponse.json(hubDelivery("not_listed") satisfies DeliveryResponse);
  }
  // Where Berth takes no new buy, a buy is not on offer to deliver anywhere.
  if (!(read.caller.availability ?? AVAILABLE).available) {
    return NextResponse.json(hubDelivery("no_new_buys") satisfies DeliveryResponse);
  }

  // The account's home EVM wallet, else the wallet this request signs as
  // (an EVM one, or deliveryFor says hub). A failed read is the hub.
  let evmAddress: string | null = null;
  try {
    evmAddress = (await accountEvmAddresses(user.id, user.wallet_address)).home ?? read.caller.wallet;
  } catch {
    return NextResponse.json(hubDelivery("read_failed") satisfies DeliveryResponse);
  }
  const delivery = deliveryFor({
    switched: true,
    evmAddress,
    country: requestCountry(request.headers, { url: request.url }),
  });
  return NextResponse.json(delivery satisfies DeliveryResponse);
}
