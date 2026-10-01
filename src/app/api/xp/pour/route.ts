import { NextResponse, type NextRequest } from "next/server";
import type { RewardList } from "@/lib/profile-types";
import { flushUnannounced } from "@/lib/server/accounts";
import { awardFilledPour, closePourClaim, fillVerdict, savePourClaim } from "@/lib/server/pour-claims";
import { forgoHold, isNoXp, markNoXp, pourPaid } from "@/lib/server/no-xp";
import { orderListingSymbol, recordOrder } from "@/lib/server/orders";
import { accountOwnedWallets } from "@/lib/server/pour-ownership";
import { verifyPourTx } from "@/lib/server/pour-verify";
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
 * The reads here are each bounded (getIntent 15s, every ownership read 5s,
 * the fill's backend look about 14s, the order's own reads), so the route
 * answers well inside this.
 */
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const read = await readRewardsCaller(request);
  if (!read.ok) return read.response;

  const kind = read.caller.body.direction === "out" ? "pour_out" : "pour_in";
  // A buy reported from where Berth is not available (lib/availability) is
  // still recorded, so the ledger stays true (the order, its marks, the
  // recurring run it answers), but it pays no XP and judges no hold, then
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

  if (!verified.ok && verified.reason === "not yet known") {
    // A read did not answer (an RPC error, a timeout): nothing is refused,
    // marked or paid on it. When the intent itself was read, a claim is kept
    // so the evening pass proves it later, and the client asks again with a
    // backoff (lib/pour-retry).
    if (verified.intent && verified.sodax) {
      await savePourClaim(
        user.id,
        txHash,
        direction,
        claimedFill,
        orderListingSymbol(verified.sodax, verified.intent, direction),
        { proven: false },
      );
    } else if (verified.intentCreated) {
      // The receipt shows a real intent the SDK could not read: kept on its
      // hash and side alone, so the evening pass finishes it even when every
      // retry from the page also finds the chain silent.
      await savePourClaim(user.id, txHash, direction, claimedFill, null, { proven: false });
    }
    return NextResponse.json({ error: verified.reason, retry: true }, { status: 503, headers: { "retry-after": "10" } });
  }
  if (!verified.ok) {
    return NextResponse.json({ error: verified.reason }, { status: 422 });
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
  if (verdict === "unknown") {
    // The claim keeps its listing, so a recurring run it may answer is not
    // offered again (a second buy) while the evening pass confirms it.
    await savePourClaim(user.id, txHash, direction, claimedFill, orderListingSymbol(verified.sodax, verified.intent, direction));
  } else if (noXp) {
    await recordOrder({
      sodax: verified.sodax,
      userId: user.id,
      intentTx: txHash,
      direction,
      intent: verified.intent,
      claimedFillTx: claimedFill,
    });
    await forgoHold(txHash);
    await closePourClaim(txHash, new Date(), "recorded_no_xp", user.id);
  } else {
    // Awaited, not fired and forgotten: a serverless function may be frozen
    // the moment it answers. recordOrder never throws, so the award is safe.
    await recordOrder({
      sodax: verified.sodax,
      userId: user.id,
      intentTx: txHash,
      direction,
      intent: verified.intent,
      claimedFillTx: claimedFill,
    });
    // The referral payoff lives here, not at signup: a filled pour is the
    // moment an invited account proves it's a person with real funds, not a
    // farm. Every award is index-deduped, so replays and later pours no-op.
    const paid = await awardFilledPour(user, kind, txHash);
    // An earlier call may have left a claim for this intent: it is paid now.
    await closePourClaim(txHash, new Date(), "paid", user.id);
    rewards.push(...paid.rewards);
    xp = paid.xp;
  }

  // Anything parked for this account (a hold paid by the cron) rides along
  // with this total, as in awardAndRespond.
  rewards.push(...(await flushUnannounced(user.id)));

  return rewardsResponse(user, { xp }, rewards);
}
