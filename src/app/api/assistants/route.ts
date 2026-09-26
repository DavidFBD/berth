import { NextResponse, type NextRequest } from "next/server";
import { listGrants, type GrantSummary } from "@/lib/server/oauth/tokens";
import { readRewardsCaller, resolveRewardsUser } from "@/lib/server/rewards-route";

export const dynamic = "force-dynamic";

export type AssistantsResponse = { grants: GrantSummary[] };

/** The assistants connected to this account (live OAuth grants). POST, like every rewards read. */
export async function POST(request: NextRequest) {
  const read = await readRewardsCaller(request);
  if (!read.ok) return read.response;
  const resolved = await resolveRewardsUser(read.caller);
  if (!resolved.ok) return resolved.response;
  const response: AssistantsResponse = { grants: await listGrants(resolved.user.id) };
  return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
}
