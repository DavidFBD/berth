import type { Intent } from "@sodax/sdk";
import { holdingChainOf } from "@/lib/orders";
import { getSql } from "@/lib/server/db";
import { recheckRobinhoodDestination, type DeliveryInputs, type DestinationCheck } from "@/lib/server/delivery";
import { isNoXp, markNoXp, pourPaid } from "@/lib/server/no-xp";

/**
 * The server's say over a buy delivered on Robinhood Chain (plan, carried
 * into P2a). Delivery already happened when Berth hears of the order: the
 * intent was built and signed in the browser and the token is in the
 * person's wallet. So the ledger records it truthfully either way
 * (orders.holding_chain 'robinhood', under its Sonic listing), and what
 * the server decides is whether it earns anything. Allowed means the same
 * decision /api/delivery makes (lib/server/delivery), made again from the
 * request that reports the order, answers Robinhood Chain to exactly the
 * wallet it was delivered to. Anything else pays nothing, then or ever
 * (lib/server/no-xp, 'delivery_refused'), with no hold and no campaign
 * credit. A hub buy is never touched here.
 *
 * The evening pass has no request, so no country to judge: it pays a
 * Robinhood Chain claim only when the pour route allowed it and said so on
 * the claim (pour_claims.delivery_ok), and marks it paying nothing
 * otherwise (settleRobinhoodClaim).
 */

/** Whether an intent is a buy delivered on Robinhood Chain. */
export function isRobinhoodBuy(direction: "buy" | "sell", intent: Pick<Intent, "srcChain" | "dstChain">): boolean {
  return direction === "buy" && holdingChainOf(direction, intent) === "robinhood";
}

export type GateOutcome =
  /** Not a Robinhood Chain buy: nothing to decide. */
  | "hub"
  /** Already paid, or already a no XP buy: decided before, never decided again. */
  | "settled"
  | DestinationCheck["verdict"];

/**
 * The pour route's check. "refused" has already marked the buy no XP;
 * "unknown" marks nothing (a read did not answer: the route asks for a
 * retry, as for an ownership read); "allowed" lets the route go on, and the
 * route records it on the claim (markDeliveryOk).
 */
export async function gateRobinhoodBuy({
  intentTx,
  direction,
  intent,
  inputs,
  recheck = recheckRobinhoodDestination,
}: {
  intentTx: string;
  direction: "buy" | "sell";
  intent: Pick<Intent, "srcChain" | "dstChain" | "dstAddress">;
  inputs: DeliveryInputs;
  recheck?: typeof recheckRobinhoodDestination;
}): Promise<GateOutcome> {
  if (!isRobinhoodBuy(direction, intent)) return "hub";
  if ((await pourPaid(intentTx)) || (await isNoXp(intentTx))) return "settled";
  const check = await recheck({ ...inputs, dstAddress: intent.dstAddress });
  if (check.verdict === "refused") {
    await markNoXp(intentTx, "delivery_refused");
    // Why, as a code, never the address or the country (the privacy policy).
    console.warn("[delivery] robinhood buy recorded without XP:", check.reason);
  }
  return check.verdict;
}

/** The pour route allowed this claim's Robinhood Chain destination. Written only for such a claim. */
export async function markDeliveryOk(intentTx: string, userId: string): Promise<void> {
  await getSql().query(`update pour_claims set delivery_ok = true where intent_tx = $1 and user_id = $2`, [intentTx.toLowerCase(), userId]);
}

/**
 * The evening pass's half, for a claim on a Robinhood Chain buy: unless
 * the pour route allowed its destination (and nothing paid or marked it
 * since), it is marked to pay nothing, so payRecordedClaim records it and
 * pays nothing. Never asked of any other claim, so the column is read only
 * for these.
 */
export async function settleRobinhoodClaim(claim: { intent_tx: string; user_id: string }): Promise<"allowed" | "refused" | "settled"> {
  if ((await pourPaid(claim.intent_tx)) || (await isNoXp(claim.intent_tx))) return "settled";
  const rows = (await getSql().query(`select delivery_ok from pour_claims where intent_tx = $1 and user_id = $2`, [
    claim.intent_tx.toLowerCase(),
    claim.user_id,
  ])) as { delivery_ok: boolean | null }[];
  if (rows[0]?.delivery_ok === true) return "allowed";
  await markNoXp(claim.intent_tx, "delivery_refused");
  console.warn("[delivery] robinhood claim settled without XP: destination never allowed");
  return "refused";
}
