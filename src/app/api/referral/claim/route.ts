import { NextResponse, type NextRequest } from "next/server";
import {
  claimReferral,
  normalizeReferralCode,
  referralPanel,
} from "@/lib/server/accounts";
import {
  readRewardsCaller,
  resolveRewardsUser,
} from "@/lib/server/rewards-route";

/**
 * The stripped-link recovery hatch: a young, unclaimed, unpoured account
 * hand-enters a friend's code and binds late. All the real guards live in
 * claimReferral's SQL; this route only shapes the conversation. Returns the
 * refreshed referral panel so the pantry can redraw in place.
 */
export async function POST(request: NextRequest) {
  const read = await readRewardsCaller(request);
  if (!read.ok) return read.response;

  const code = normalizeReferralCode(read.caller.body.code);
  if (!code) {
    return NextResponse.json({ error: "bad code" }, { status: 400 });
  }

  const resolved = await resolveRewardsUser(read.caller);
  if (!resolved.ok) return resolved.response;
  const { user } = resolved;

  const referrerId = await claimReferral(user.id, code);
  if (!referrerId) {
    // One answer for every miss (unknown code, own code, too old, already
    // claimed, already poured): the row simply didn't take.
    return NextResponse.json({ error: "code did not take" }, { status: 422 });
  }

  return NextResponse.json(
    await referralPanel({ ...user, referred_by: referrerId }),
  );
}
