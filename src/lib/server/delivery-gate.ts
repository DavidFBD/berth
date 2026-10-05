import type { Intent } from "@sodax/sdk";
import { holdingChainOf } from "@/lib/orders";
import { getSql } from "@/lib/server/db";
import {
  deliveryPlace,
  recheckDestination,
  type DeliveryInputs,
  type DeliveryPlace,
  type DestinationCheck,
} from "@/lib/server/delivery";
import { isNoXp, markNoXp, pourPaid } from "@/lib/server/no-xp";

/**
 * The server's say over a buy delivered on Robinhood Chain (plan, carried
 * into P2a). Delivery already happened when Berth hears of the order: the
 * intent was built and signed in the browser and the token is in the
 * person's wallet. So the ledger records it truthfully either way
 * (orders.holding_chain 'robinhood', under its Sonic listing), and what
 * the server decides is whether it earns anything. Allowed means the same
 * decision /api/delivery makes (lib/server/delivery) answers Robinhood
 * Chain to exactly the wallet it was delivered to. Anything else pays
 * nothing, then or ever (lib/server/no-xp, 'delivery_refused'), with no
 * hold and no campaign credit. A hub buy is never touched here.
 *
 * The decision is written on the claim in the statement that keeps it
 * (pour_claims.delivery_ok, true or false), together with what it was made
 * from that only the request knows: the session's signing wallet
 * (delivery_signer) and the place's yes or no (delivery_place_ok: the
 * switch, where Berth takes buys, the country). Once written it is never
 * made again. A claim whose decision a read kept open (delivery_ok null)
 * is decided again by each evening pass from those stored facts, the
 * account's wallets and the chain read live; an answer that still does not
 * come waits, up to DELIVERY_DECISION_DAYS after the claim was kept, and
 * is then refused. A Robinhood Chain buy that only recovery found has no
 * report to decide from and is refused (settleRecoveredRobinhoodBuy).
 */

/** How long a claim whose delivery decision a read kept open may wait for an answer before it is refused. */
export const DELIVERY_DECISION_DAYS = 7;

/** Whether an intent is a buy delivered on Robinhood Chain. */
export function isRobinhoodBuy(direction: "buy" | "sell", intent: Pick<Intent, "srcChain" | "dstChain">): boolean {
  return direction === "buy" && holdingChainOf(direction, intent) === "robinhood";
}

/**
 * What the pour route writes on a Robinhood Chain claim (savePourClaim):
 * the decision (null while a read kept it open) and the facts it was made
 * from that only the reporting request knows.
 */
export type ClaimDelivery = { ok: boolean | null; signer: string | null; placeOk: boolean };

/** The request's half of the facts, for a claim kept before the decision could be made at all (the intent could not be proven yet). */
export function requestDelivery(inputs: Pick<DeliveryInputs, "userId" | "usersWallet" | "signer" | "availability" | "country">): ClaimDelivery {
  return { ok: null, signer: inputs.signer ?? null, placeOk: deliveryPlace(inputs).ok };
}

type StoredDelivery = { delivery_ok: boolean | null; delivery_signer: string | null; delivery_place_ok: boolean | null; created_at: string | Date };

async function storedDelivery(intentTx: string, userId: string): Promise<StoredDelivery | undefined> {
  const rows = (await getSql().query(
    `select delivery_ok, delivery_signer, delivery_place_ok, created_at from pour_claims where intent_tx = $1 and user_id = $2`,
    [intentTx.toLowerCase(), userId],
  )) as StoredDelivery[];
  return rows[0];
}

/** The place a stored claim's facts give: the stored yes, or a no that says it was judged at report time. */
const storedPlace = (placeOk: boolean): DeliveryPlace => (placeOk ? { ok: true } : { ok: false, reason: "place_at_report" });

function refuse(intentTx: string, why: string): Promise<void> {
  // Why, as a code, never the address or the country (the privacy policy).
  console.warn("[delivery] robinhood buy recorded without XP:", why);
  return markNoXp(intentTx, "delivery_refused");
}

export type GateOutcome =
  /** Not a Robinhood Chain buy: nothing to decide. */
  | "hub"
  /** Already paid, or already a no XP buy: decided before, never decided again. */
  | "settled"
  | DestinationCheck["verdict"];

/**
 * The pour route's check, after the intent is proven the account's.
 * "refused" has already marked the buy no XP; "unknown" marks nothing (a
 * read did not answer: the route keeps the claim and asks for a retry);
 * "allowed" lets the route go on. `delivery` is what the route writes on
 * the claim (savePourClaim). A claim already decided keeps its decision;
 * one kept open keeps the facts it was first kept with.
 */
export async function gateRobinhoodBuy({
  intentTx,
  direction,
  intent,
  inputs,
  recheck = recheckDestination,
}: {
  intentTx: string;
  direction: "buy" | "sell";
  intent: Pick<Intent, "srcChain" | "dstChain" | "dstAddress">;
  inputs: DeliveryInputs;
  recheck?: typeof recheckDestination;
}): Promise<{ outcome: GateOutcome; delivery?: ClaimDelivery }> {
  if (!isRobinhoodBuy(direction, intent)) return { outcome: "hub" };
  if ((await pourPaid(intentTx)) || (await isNoXp(intentTx))) return { outcome: "settled" };
  const stored = await storedDelivery(intentTx, inputs.userId);
  const hasFacts = stored?.delivery_place_ok === true || stored?.delivery_place_ok === false;
  const signer = hasFacts ? stored.delivery_signer : (inputs.signer ?? null);
  const place = hasFacts ? storedPlace(stored.delivery_place_ok as boolean) : deliveryPlace(inputs);
  const facts = { signer, placeOk: place.ok };
  if (stored?.delivery_ok === true) return { outcome: "allowed", delivery: { ok: true, ...facts } };
  if (stored?.delivery_ok === false) {
    await refuse(intentTx, "decided before");
    return { outcome: "refused", delivery: { ok: false, ...facts } };
  }
  const check = await recheck({
    userId: inputs.userId,
    usersWallet: inputs.usersWallet,
    signer,
    place,
    dstAddress: intent.dstAddress,
    fetcher: inputs.fetcher,
  });
  if (check.verdict === "refused") await refuse(intentTx, check.reason);
  return { outcome: check.verdict, delivery: { ok: check.verdict === "unknown" ? null : check.verdict === "allowed", ...facts } };
}

async function writeDecision(intentTx: string, userId: string, ok: boolean): Promise<void> {
  await getSql().query(`update pour_claims set delivery_ok = $3 where intent_tx = $1 and user_id = $2 and delivery_ok is null`, [
    intentTx.toLowerCase(),
    userId,
    ok,
  ]);
}

/**
 * The evening pass's half, for a claim on a Robinhood Chain buy. A
 * decision on the claim stands: true pays, false is marked to pay nothing.
 * A claim kept open is decided again from its stored facts, and the answer
 * written on it. "wait" is a decision a read still kept open, or a claim
 * with no stored facts, younger than DELIVERY_DECISION_DAYS: the pass
 * records the order and leaves the claim for the next night. Older, it is
 * refused. Never asked of any other claim.
 */
export async function settleRobinhoodClaim(
  claim: { intent_tx: string; user_id: string; wallet_address?: string | null; created_at?: string | Date },
  intent: Pick<Intent, "dstAddress">,
  { now = new Date(), recheck = recheckDestination }: { now?: Date; recheck?: typeof recheckDestination } = {},
): Promise<"allowed" | "refused" | "settled" | "wait"> {
  if ((await pourPaid(claim.intent_tx)) || (await isNoXp(claim.intent_tx))) return "settled";
  const stored = await storedDelivery(claim.intent_tx, claim.user_id);
  if (stored?.delivery_ok === true) return "allowed";
  if (stored?.delivery_ok === false) {
    await refuse(claim.intent_tx, "decided at report");
    return "refused";
  }
  if (stored && (stored.delivery_place_ok === true || stored.delivery_place_ok === false)) {
    const check = await recheck({
      userId: claim.user_id,
      usersWallet: claim.wallet_address ?? null,
      signer: stored.delivery_signer,
      place: storedPlace(stored.delivery_place_ok),
      dstAddress: intent.dstAddress,
    });
    if (check.verdict === "allowed") {
      await writeDecision(claim.intent_tx, claim.user_id, true);
      return "allowed";
    }
    if (check.verdict === "refused") {
      await writeDecision(claim.intent_tx, claim.user_id, false);
      await refuse(claim.intent_tx, check.reason);
      return "refused";
    }
  }
  const kept = stored?.created_at ?? claim.created_at;
  const age = kept ? now.getTime() - new Date(kept).getTime() : Number.POSITIVE_INFINITY;
  if (age <= DELIVERY_DECISION_DAYS * 86_400_000) return "wait";
  await writeDecision(claim.intent_tx, claim.user_id, false);
  await refuse(claim.intent_tx, "never decided");
  return "refused";
}

/**
 * A Robinhood Chain buy found only by recovery (lib/server/orders-recover):
 * no report means no signing wallet and no place to decide from, so it
 * earns nothing, then or ever, and a report made later (from another
 * place, once switched on) pays nothing either. One with an open claim is
 * left to the evening pass, which decides it from the claim's facts. A buy
 * already paid is history, never marked after the fact.
 */
export async function settleRecoveredRobinhoodBuy(intentTx: string): Promise<"settled" | "claim" | "refused"> {
  if ((await pourPaid(intentTx)) || (await isNoXp(intentTx))) return "settled";
  const open = (await getSql().query(`select 1 from pour_claims where intent_tx = $1 and settled_at is null limit 1`, [
    intentTx.toLowerCase(),
  ])) as unknown[];
  if (open.length > 0) return "claim";
  await refuse(intentTx, "recovered without a report");
  return "refused";
}
