import { NextResponse, type NextRequest } from "next/server";
import { isAvatarId } from "@/lib/avatars";
import { setAvatar } from "@/lib/server/accounts";
import {
  awardAndRespond,
  readRewardsCaller,
  resolveRewardsUser,
} from "@/lib/server/rewards-route";

/**
 * Pick a face from the preset shelf. First pick pays the one-time reward.
 * Auth: Privy token when present; wallet-only users are trusted by address
 * (low stakes: the only thing an imposter could do is choose a different
 * teapot — SIWE hardening is noted in thoughts.md if that ever matters).
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

  await setAvatar(resolved.user.id, avatarId);
  return awardAndRespond(resolved.user, "avatar_set", null, {
    avatar_id: avatarId,
  });
}
