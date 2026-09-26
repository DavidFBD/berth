import { NextResponse, type NextRequest } from "next/server";
import { listGrants, revokeUserGrant } from "@/lib/server/oauth/tokens";
import { readRewardsCaller, resolveRewardsUser } from "@/lib/server/rewards-route";
import type { AssistantsResponse } from "@/app/api/assistants/route";

export const dynamic = "force-dynamic";

/**
 * Disconnect one assistant: revoke the grant and every token under it, so
 * its next call to /mcp is refused. POST { grantId }; answers the list that
 * remains.
 */
export async function POST(request: NextRequest) {
  const read = await readRewardsCaller(request);
  if (!read.ok) return read.response;
  const resolved = await resolveRewardsUser(read.caller);
  if (!resolved.ok) return resolved.response;
  const grantId = read.caller.body.grantId;
  if (typeof grantId !== "string") return NextResponse.json({ error: "grantId required" }, { status: 400 });
  await revokeUserGrant(resolved.user.id, grantId);
  const response: AssistantsResponse = { grants: await listGrants(resolved.user.id) };
  return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
}
