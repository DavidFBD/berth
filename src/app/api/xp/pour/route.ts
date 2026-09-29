import { NextResponse, type NextRequest } from "next/server";
import type { RewardList } from "@/lib/profile-types";
import { flushUnannounced } from "@/lib/server/accounts";
import { linkedWallets } from "@/lib/server/identities";
import { awardFilledPour, closePourClaim, fillVerdict, savePourClaim } from "@/lib/server/pour-claims";
import { recordOrder } from "@/lib/server/orders";
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
export async function POST(request: NextRequest) {
  const read = await readRewardsCaller(request);
  if (!read.ok) return read.response;

  const kind = read.caller.body.direction === "out" ? "pour_out" : "pour_in";
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
  // tea vault on the claimed side, and (when its source speaks EVM) must
  // have been poured by this account's own wallet. See pour-verify.ts.
  const verified = await verifyPourTx({
    txHash,
    direction: kind === "pour_out" ? "out" : "in",
    accountWallet: user.wallet_address,
    linkedWallets: (await linkedWallets(user.id, user.wallet_address))
      .filter((wallet) => wallet.family === "evm")
      .map((wallet) => ({ address: wallet.address, linkedAt: Date.parse(wallet.linkedAt) })),
  });
  if (!verified.ok) {
    return NextResponse.json({ error: verified.reason }, { status: 422 });
  }

  const claimedFill =
    typeof read.caller.body.fillTxHash === "string" &&
    /^0x[0-9a-f]{64}$/i.test(read.caller.body.fillTxHash)
      ? read.caller.body.fillTxHash
      : null;
  const direction = kind === "pour_out" ? "sell" : "buy";

  // XP only for an order that filled (lib/server/pour-claims): a created
  // then cancelled or expired intent earns nothing. When the fill cannot
  // be confirmed yet, a claim is kept and the evening pass pays it.
  const verdict = await fillVerdict({ intentTx: txHash, intent: verified.intent, claimedFillTx: claimedFill });
  if (verdict === "notFilled") {
    return NextResponse.json({ error: "not filled" }, { status: 422 });
  }
  const rewards: RewardList = [];
  let xp = user.xp;
  if (verdict === "unknown") {
    await savePourClaim(user.id, txHash, direction, claimedFill);
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
    await closePourClaim(txHash);
    rewards.push(...paid.rewards);
    xp = paid.xp;
  }

  // Anything parked for this account (a hold paid by the cron) rides along
  // with this total, as in awardAndRespond.
  rewards.push(...(await flushUnannounced(user.id)));

  return rewardsResponse(user, { xp }, rewards);
}
