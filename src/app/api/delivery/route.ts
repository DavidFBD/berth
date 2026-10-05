import { NextResponse, type NextRequest } from "next/server";
import { deliveryFor } from "@/lib/delivery";
import { accountEvmAddresses } from "@/lib/server/identities";
import { AVAILABLE, requestCountry } from "@/lib/server/availability";
import { robinhoodDeliveryOn } from "@/lib/server/delivery";
import { readRewardsCaller, resolveRewardsUser } from "@/lib/server/rewards-route";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

/**
 * Where the signed-in account's next buy is delivered (lib/delivery),
 * behind the ROBINHOOD_DELIVERY_USERS switch (lib/server/delivery). One
 * POST, no body:
 *
 *   { robinhood: true, address }   delivered to `address`, the account's
 *                                  own EVM wallet, on Robinhood Chain
 *   { robinhood: false, address: null }
 *                                  the hub, as every buy before
 *
 * Everyone not switched on gets the second answer and nothing else, before
 * any further read. Switched on, the hub is still the answer where Berth
 * takes no new buy, where Robinhood does not offer its tokens (the United
 * Kingdom, Canada, Switzerland), when the country is unknown, and for an
 * account with no EVM wallet. Same proof of identity as the rewards routes:
 * a Privy token or a wallet session.
 */
export type DeliveryResponse = { robinhood: boolean; address: string | null };

const HUB: DeliveryResponse = { robinhood: false, address: null };

export async function POST(request: NextRequest) {
  const read = await readRewardsCaller(request);
  if (!read.ok) return read.response;
  const resolved = await resolveRewardsUser(read.caller);
  if (!resolved.ok) return resolved.response;
  const { user } = resolved;

  if (!robinhoodDeliveryOn([user.id, user.wallet_address, read.caller.wallet])) {
    return NextResponse.json(HUB satisfies DeliveryResponse);
  }
  // Where Berth takes no new buy, a buy is not on offer to deliver anywhere.
  if (!(read.caller.availability ?? AVAILABLE).available) return NextResponse.json(HUB satisfies DeliveryResponse);

  // The account's home EVM wallet, else the wallet this request signs as
  // (an EVM one, or deliveryFor says hub). A failed read is the hub.
  let evmAddress: string | null = null;
  try {
    evmAddress = (await accountEvmAddresses(user.id, user.wallet_address)).home ?? read.caller.wallet;
  } catch {
    return NextResponse.json(HUB satisfies DeliveryResponse);
  }
  const delivery = deliveryFor({
    switched: true,
    evmAddress,
    country: requestCountry(request.headers, { url: request.url }),
  });
  return NextResponse.json({
    robinhood: delivery.chainKey === "robinhood",
    address: delivery.address,
  } satisfies DeliveryResponse);
}
