import { NextResponse, type NextRequest } from "next/server";
import { referralPanel } from "@/lib/server/accounts";
import {
  readRewardsCaller,
  resolveRewardsUser,
} from "@/lib/server/rewards-route";

/**
 * The pantry's referral corner, both directions: who set this account's
 * seat, and how its own invitations are brewing. Separate from the profile
 * envelope so the hot XP routes stay cheap.
 */
export async function POST(request: NextRequest) {
  const read = await readRewardsCaller(request);
  if (!read.ok) return read.response;
  const resolved = await resolveRewardsUser(read.caller);
  if (!resolved.ok) return resolved.response;

  return NextResponse.json(await referralPanel(resolved.user));
}
