import { NextResponse, type NextRequest } from "next/server";
import type { RewardList } from "@/lib/profile-types";
import { awardXp } from "@/lib/server/accounts";
import { verifyPourTx } from "@/lib/server/pour-verify";
import {
  readRewardsCaller,
  resolveRewardsUser,
  rewardsResponse,
} from "@/lib/server/rewards-route";

/** Reward a filled pour. Body: direction ('in' | 'out') + the intent's hub tx hash. */
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
  const verdict = await verifyPourTx({
    txHash,
    direction: kind === "pour_out" ? "out" : "in",
    accountWallet: user.wallet_address,
  });
  if (!verdict.ok) {
    return NextResponse.json({ error: verdict.reason }, { status: 422 });
  }

  const rewards: RewardList = [];
  const pour = await awardXp(user.id, kind, txHash);
  let xp = pour.xp;
  if (pour.awarded > 0) rewards.push({ kind, amount: pour.awarded });

  // The referral payoff lives here, not at signup: a verified pour is the
  // moment an invited account proves it's a person with real funds, not a
  // farm. Both awards are index-deduped (invite_accepted once per account,
  // friend_poured once per referred id), so replays and later pours no-op.
  if (user.referred_by) {
    const accepted = await awardXp(user.id, "invite_accepted", null);
    xp = accepted.xp;
    if (accepted.awarded > 0) {
      rewards.push({ kind: "invite_accepted", amount: accepted.awarded });
    }
    // The referrer's reward lands on their row now, parked unannounced; their
    // next profile sync flushes it into a visible toast (see profile route).
    await awardXp(user.referred_by, "friend_poured", user.id, {
      announced: false,
    });
  }

  return rewardsResponse(user, { xp }, rewards);
}
