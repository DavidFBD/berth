import { NextResponse, type NextRequest } from "next/server";
import { isAppearanceId } from "@/lib/appearance";
import {
  awardAndRespond,
  readRewardsCaller,
  resolveRewardsUser,
} from "@/lib/server/rewards-route";

/**
 * A first taste of a mode. The dedup ref scopes the award to (account,
 * mode): flipping back and forth pays nothing after the first sip, which is
 * the whole abuse story — the ceiling is modes × 10 XP per account.
 */
export async function POST(request: NextRequest) {
  const read = await readRewardsCaller(request);
  if (!read.ok) return read.response;

  const mode = read.caller.body.mode;
  if (!isAppearanceId(mode)) {
    return NextResponse.json({ error: "unknown mode" }, { status: 400 });
  }

  const resolved = await resolveRewardsUser(read.caller);
  if (!resolved.ok) return resolved.response;
  return awardAndRespond(
    resolved.user,
    "theme_tried",
    `${resolved.user.id}:${mode}`,
  );
}
