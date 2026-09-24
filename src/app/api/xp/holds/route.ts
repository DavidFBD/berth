import { NextResponse, type NextRequest } from "next/server";
import { pendingHolds } from "@/lib/server/holds";
import type { HoldsResponse } from "@/lib/profile-types";
import {
  readRewardsCaller,
  resolveRewardsUser,
} from "@/lib/server/rewards-route";

/**
 * The account's buys still waiting on their thirty day check. Same auth
 * ritual and method (POST, as every rewards call in use-profile) as the
 * house ledger (/api/xp/history); the query lives in lib/server/holds.
 */
export async function POST(request: NextRequest) {
  const read = await readRewardsCaller(request);
  if (!read.ok) return read.response;
  const resolved = await resolveRewardsUser(read.caller);
  if (!resolved.ok) return resolved.response;

  const response: HoldsResponse = { holds: await pendingHolds(resolved.user.id) };
  return NextResponse.json(response);
}
