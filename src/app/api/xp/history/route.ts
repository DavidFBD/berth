import { NextResponse, type NextRequest } from "next/server";
import { xpHistory } from "@/lib/server/accounts";
import type { XpHistoryResponse } from "@/lib/profile-types";
import {
  readRewardsCaller,
  resolveRewardsUser,
} from "@/lib/server/rewards-route";

/** The house ledger. The query lives in the till (accounts.xpHistory). */
export async function POST(request: NextRequest) {
  const read = await readRewardsCaller(request);
  if (!read.ok) return read.response;
  const resolved = await resolveRewardsUser(read.caller);
  if (!resolved.ok) return resolved.response;

  const response: XpHistoryResponse = {
    events: await xpHistory(resolved.user.id),
  };
  return NextResponse.json(response);
}
