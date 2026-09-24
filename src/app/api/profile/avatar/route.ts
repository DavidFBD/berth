import { NextResponse, type NextRequest } from "next/server";
import { canUseAvatar, isAvatarId } from "@/lib/avatars";
import { rankForXp } from "@/lib/xp";
import { setAvatar } from "@/lib/server/accounts";
import {
  awardAndRespond,
  readRewardsCaller,
  resolveRewardsUser,
} from "@/lib/server/rewards-route";

/**
 * Pick a face from the preset shelf. First pick pays the one-time reward.
 * Auth: Privy token, or a SIWE wallet session (readRewardsCaller enforces
 * one of the two — nobody is trusted by address anymore).
 */
export async function POST(request: NextRequest) {
  const read = await readRewardsCaller(request);
  if (!read.ok) return read.response;

  const avatarId = read.caller.body.avatarId;
  if (typeof avatarId !== "string" || !isAvatarId(avatarId)) {
    return NextResponse.json({ error: "unknown avatar" }, { status: 400 });
  }

  const resolved = await resolveRewardsUser(read.caller);
  if (!resolved.ok) return resolved.response;

  // The rank-gated faces: the picker says why, the server makes it true.
  if (!canUseAvatar(avatarId, rankForXp(resolved.user.xp).level)) {
    return NextResponse.json({ error: "locked" }, { status: 403 });
  }

  await setAvatar(resolved.user.id, avatarId);
  return awardAndRespond(resolved.user, "avatar_set", null, {
    avatar_id: avatarId,
  });
}
