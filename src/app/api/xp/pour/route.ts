import { NextResponse, type NextRequest } from "next/server";
import type { RewardList } from "@/lib/profile-types";
import { flushUnannounced } from "@/lib/server/accounts";
import { awardFilledPour, awardRobinhoodSell, closePourClaim, fillVerdict, savePourClaim } from "@/lib/server/pour-claims";
import { forgoHold, isNoXp, markNoXp, pourPaid } from "@/lib/server/no-xp";
import { requestCountry } from "@/lib/server/availability";
import { gateRobinhoodBuy, isRobinhoodBuy, requestDelivery } from "@/lib/server/delivery-gate";
import { orderListingSymbol, recordOrder } from "@/lib/server/orders";
import { accountOwnedWallets } from "@/lib/server/pour-ownership";
import { verifyPourTx } from "@/lib/server/pour-verify";
import { robinhoodPourXp } from "@/lib/server/robinhood-xp";
import { holdingChainOf } from "@/lib/orders";
import {
  readRewardsCaller,
  resolveRewardsUser,
  rewardsResponse,
} from "@/lib/server/rewards-route";

/**
 * Reward a filled pour, and record it as an order. Body: direction
 * ('in' | 'out'), the intent's hub tx hash, and optionally the solver's fill
 * tx hash, which is only where to look: the fill must be on chain, for this
 * intent, whole (lib/server/pour-claims), before anything is paid. An
 * intent not yet known to have filled is kept as a claim the evening pass
 * settles; one that closed unfilled earns nothing.
 */
/**
 * The reads here are each bounded (hub reads 4s an endpoint and 8s across
 * the failover, getIntent 15s, every ownership read 5s, the fill receipt
 * 5s, the fill's backend look about 14s, the order's own reads 8s each).
 * Their sum on a bad day can still pass this, so a filled pour is kept as
 * a claim before the order is written, and the evening pass finishes what
 * a stopped function did not.
 */
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const read = await readRewardsCaller(request);
  if (!read.ok) return read.response;

  const kind = read.caller.body.direction === "out" ? "pour_out" : "pour_in";
  // A buy reported from where Berth is not available (lib/availability) is
  // still recorded, so the ledger stays true (the order and its marks),
  // but it pays no XP and judges no hold, then
  // or ever: it is marked by intent (lib/server/no-xp), so a report of the
  // same buy from anywhere else pays nothing either. The app does not
  // offer such a buy; this is for one that happened anyway. Availability is
  // judged when the buy is reported. A sell is always recorded and paid.
  const availability = read.caller.availability;
  const away = kind === "pour_in" && availability !== undefined && !availability.available ? availability : null;
  const txHash =
    typeof read.caller.body.intentTxHash === "string"
      ? read.caller.body.intentTxHash.toLowerCase()
      : "";
  if (!/^0x[0-9a-f]{64}$/.test(txHash)) {
    return NextResponse.json({ error: "bad tx hash" }, { status: 400 });
  }

  const resolved = await resolveRewardsUser(read.caller);
  if (!resolved.ok) return resolved.response;
  const { user } = resolved;

  // The hash must be a real intent on the canonical contract, must touch a
  // listing on the claimed side, and must be this account's own, from
  // whichever family it was paid (lib/server/pour-ownership). One that is
  // not proven records nothing and claims nothing here, so its real owner
  // can still report it.
  const verified = await verifyPourTx({
    txHash,
    direction: kind === "pour_out" ? "out" : "in",
    wallets: await accountOwnedWallets(user.id, user.wallet_address),
  });
  const claimedFill =
    typeof read.caller.body.fillTxHash === "string" &&
    /^0x[0-9a-f]{64}$/i.test(read.caller.body.fillTxHash)
      ? read.caller.body.fillTxHash
      : null;
  const direction = kind === "pour_out" ? "sell" : "buy";
  // What the delivery decision of a buy on Robinhood Chain is made from
  // (lib/server/delivery-gate), from this request.
  const deliveryInputs = {
    userId: user.id,
    usersWallet: user.wallet_address,
    signer: read.caller.wallet,
    availability,
    country: requestCountry(request.headers, { url: request.url }),
  };

  if (!verified.ok && verified.reason === "not yet known") {
    // A read did not answer (an RPC error, a timeout): nothing is refused,
    // marked or paid on it. When the intent itself was read, a claim is kept
    // so the evening pass proves it later, and the client asks again with a
    // backoff (lib/pour-retry).
    // A buy delivered on Robinhood Chain, or one whose intent is not read
    // yet, keeps what only this request knows for its delivery decision,
    // which the evening pass makes once the intent is proven.
    if (verified.intent && verified.sodax) {
      await savePourClaim(
        user.id,
        txHash,
        direction,
        claimedFill,
        orderListingSymbol(verified.sodax, verified.intent, direction),
        { proven: false, delivery: isRobinhoodBuy(direction, verified.intent) ? requestDelivery(deliveryInputs) : undefined },
      );
    } else if (verified.intentCreated) {
      // The receipt shows a real intent the SDK could not read: kept on its
      // hash and side alone, so the evening pass finishes it even when every
      // retry from the page also finds the chain silent.
      await savePourClaim(user.id, txHash, direction, claimedFill, null, {
        proven: false,
        delivery: direction === "buy" ? requestDelivery(deliveryInputs) : undefined,
      });
    }
    return NextResponse.json({ error: verified.reason, retry: true }, { status: 503, headers: { "retry-after": "10" } });
  }
  if (!verified.ok) {
    return NextResponse.json({ error: verified.reason }, { status: 422 });
  }

  // A buy delivered on Robinhood Chain (plan P2a): the delivery decision
  // /api/delivery makes is made again here, from this request, and the buy
  // earns only when it answers Robinhood Chain to the very wallet it went
  // to (lib/server/delivery-gate). A refused one is still recorded, held
  // on Robinhood Chain, and pays nothing, then or ever. A read that did not
  // answer refuses nothing: the claim keeps what this request knows, the
  // client asks again, and the evening pass decides it if no retry does.
  const gate = await gateRobinhoodBuy({ intentTx: txHash, direction, intent: verified.intent, inputs: deliveryInputs });
  if (gate.outcome === "unknown") {
    await savePourClaim(user.id, txHash, direction, claimedFill, orderListingSymbol(verified.sodax, verified.intent, direction), {
      delivery: gate.delivery,
    });
    return NextResponse.json({ error: "not yet known", retry: true }, { status: 503, headers: { "retry-after": "10" } });
  }

  // XP only for an order that filled (lib/server/pour-claims): a created
  // then cancelled or expired intent earns nothing. When the fill cannot
  // be confirmed yet, a claim is kept and the evening pass pays it.
  const verdict = await fillVerdict({ intentTx: txHash, intent: verified.intent, claimedFillTx: claimedFill });
  if (verdict === "notFilled") {
    return NextResponse.json({ error: "not filled" }, { status: 422 });
  }
  const rewards: RewardList = [];
  let xp = user.xp;
  // Marked only once the intent is proven real and this account's (above).
  // A buy already paid is a replay, never marked after the fact.
  let noXp = false;
  if (verified.unprovenSource && !(await pourPaid(txHash))) {
    // A buy delivered to this account's own hub wallet whose payer cannot
    // be proven the account's (a Sui or Stellar source, say): the stock is
    // the account's, so the ledger records it, but it pays nothing, then or
    // ever, and no hold or referral pair rides on it (lib/server/no-xp). A
    // buy already paid is a replay and is never marked after the fact.
    await markNoXp(txHash, "unproven_source");
    noXp = true;
  } else if (kind === "pour_in") {
    if (away && !(await pourPaid(txHash))) {
      await markNoXp(txHash);
      noXp = true;
      // That it happened, nothing about where or who: the privacy policy
      // says the country is never stored or logged.
      console.info("[availability] buy recorded from an excluded place");
    } else if (await isNoXp(txHash)) {
      noXp = true;
    }
  }
  // The claim keeps its listing while the evening pass confirms it. A filled
  // pour keeps one too, before the order's reads: should the function be
  // stopped at maxDuration while they wait on a hung endpoint, the evening
  // pass records and pays it (lib/server/pour-claims payClaim). Closed below
  // once paid or recorded.
  // A Robinhood Chain claim carries the gate's decision, true or false, in
  // the same statement, so the evening pass never reads it without one.
  const listingSymbol = orderListingSymbol(verified.sodax, verified.intent, direction);
  if (gate.delivery) await savePourClaim(user.id, txHash, direction, claimedFill, listingSymbol, { delivery: gate.delivery });
  else await savePourClaim(user.id, txHash, direction, claimedFill, listingSymbol);
  // A Robinhood Chain buy whose fill was not read yet (its row's quantity
  // empty) keeps its claim open whatever it earned here: the evening pass
  // builds the row again from the fill transaction (pour-claims payClaim),
  // and any XP it pays then is index-deduped, so nothing is paid twice.
  const complete = (recorded: Awaited<ReturnType<typeof recordOrder>>) =>
    gate.outcome === "hub" || (recorded !== undefined && recorded.order.quantity !== null);
  // An unknown verdict stops at the claim: the evening pass confirms it.
  if (verdict === "filled" && noXp) {
    const recorded = await recordOrder({
      sodax: verified.sodax,
      userId: user.id,
      intentTx: txHash,
      direction,
      intent: verified.intent,
      claimedFillTx: claimedFill,
    });
    await forgoHold(txHash);
    if (complete(recorded)) await closePourClaim(txHash, new Date(), "recorded_no_xp", user.id);
  } else if (verdict === "filled") {
    // Awaited, not fired and forgotten: a serverless function may be frozen
    // the moment it answers. recordOrder never throws, so the award is safe.
    const recorded = await recordOrder({
      sodax: verified.sodax,
      userId: user.id,
      intentTx: txHash,
      direction,
      intent: verified.intent,
      claimedFillTx: claimedFill,
    });
    // On Robinhood Chain (lib/server/robinhood-xp, owner decisions D1, D2):
    // a buy earns once its delivery is in the wallet, and until then its
    // claim stays open and the client asks again; a sell earns only up to
    // the Berth buys delivered there, checked and paid in one locked step.
    // Every other order earns as before.
    const onRobinhood = holdingChainOf(direction, verified.intent) === "robinhood";
    if (onRobinhood && direction === "sell") {
      const sold = await awardRobinhoodSell(user, txHash);
      if (sold.verdict === "wait") {
        return NextResponse.json({ error: "not yet known", retry: true }, { status: 503, headers: { "retry-after": "10" } });
      }
      if (complete(recorded)) await closePourClaim(txHash, new Date(), sold.verdict === "paid" ? "paid" : "recorded_no_xp", user.id);
      rewards.push(...sold.rewards);
      if (sold.xp !== null) xp = sold.xp;
    } else {
      const xpGate = onRobinhood ? await robinhoodPourXp(txHash, { onRobinhood }) : "pay";
      if (xpGate === "wait") {
        return NextResponse.json({ error: "not yet arrived", retry: true }, { status: 503, headers: { "retry-after": "10" } });
      }
      if (xpGate === "never") {
        if (direction === "buy") {
          // Never to count for a later sell either (lib/server/robinhood-xp).
          if (!(await pourPaid(txHash))) await markNoXp(txHash, "delivery_refused");
          await forgoHold(txHash);
        }
        if (complete(recorded)) await closePourClaim(txHash, new Date(), "recorded_no_xp", user.id);
      } else {
        // The referral payoff lives here, not at signup: a filled pour is the
        // moment an invited account proves it's a person with real funds, not a
        // farm. Every award is index-deduped, so replays and later pours no-op.
        const paid = await awardFilledPour(user, kind, txHash);
        // An earlier call may have left a claim for this intent: it is paid now.
        if (complete(recorded)) await closePourClaim(txHash, new Date(), "paid", user.id);
        rewards.push(...paid.rewards);
        xp = paid.xp;
      }
    }
  }

  // Anything parked for this account (a hold paid by the cron) rides along
  // with this total, as in awardAndRespond.
  rewards.push(...(await flushUnannounced(user.id)));

  return rewardsResponse(user, { xp }, rewards);
}
