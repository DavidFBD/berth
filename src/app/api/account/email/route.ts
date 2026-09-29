import { NextResponse, type NextRequest } from "next/server";
import { emailSettings } from "@/lib/server/email/settings";
import { readRewardsCaller, resolveRewardsUser } from "@/lib/server/rewards-route";

export const dynamic = "force-dynamic";

/** The account's email settings: the address notices go to, and each switch. POST, like every rewards read. */
export async function POST(request: NextRequest) {
  const read = await readRewardsCaller(request);
  if (!read.ok) return read.response;
  const resolved = await resolveRewardsUser(read.caller);
  if (!resolved.ok) return resolved.response;
  return NextResponse.json(await emailSettings(resolved.user.id), { headers: { "Cache-Control": "no-store" } });
}
