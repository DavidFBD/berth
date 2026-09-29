import { NextResponse, type NextRequest } from "next/server";
import { isSwitchableKind } from "@/lib/email-kinds";
import { emailSettings } from "@/lib/server/email/settings";
import { setPref } from "@/lib/server/email/store";
import { readRewardsCaller, resolveRewardsUser } from "@/lib/server/rewards-route";

export const dynamic = "force-dynamic";

/**
 * POST /api/account/email/prefs { kind, enabled }: one switch. Security is
 * not a kind here: it cannot be switched off. Answers the settings as they
 * now stand.
 */
export async function POST(request: NextRequest) {
  const read = await readRewardsCaller(request);
  if (!read.ok) return read.response;
  const { kind, enabled } = read.caller.body as { kind?: unknown; enabled?: unknown };
  if (!isSwitchableKind(kind) || typeof enabled !== "boolean") {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const resolved = await resolveRewardsUser(read.caller);
  if (!resolved.ok) return resolved.response;
  await setPref(resolved.user.id, kind, enabled);
  return NextResponse.json(await emailSettings(resolved.user.id), { headers: { "Cache-Control": "no-store" } });
}
