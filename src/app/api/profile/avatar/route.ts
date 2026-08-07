import { NextResponse, type NextRequest } from "next/server";
import { isAvatarId } from "@/lib/avatars";
import { verifyPrivyAuth } from "@/lib/server/privy";
import {
  awardXp,
  getOrCreateUser,
  normalizeWallet,
  setAvatar,
  toProfile,
} from "@/lib/server/accounts";

/**
 * Pick a face from the preset shelf. First pick pays the one-time reward.
 * Auth: Privy token when present; wallet-only users are trusted by address
 * (low stakes: the only thing an imposter could do is choose a different
 * teapot — SIWE hardening is noted in thoughts.md if that ever matters).
 */
export async function POST(request: NextRequest) {
  let did: string | null;
  try {
    did = await verifyPrivyAuth(request.headers.get("authorization"));
  } catch {
    return NextResponse.json({ error: "invalid token" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    avatarId?: unknown;
    walletAddress?: unknown;
  };
  const wallet = normalizeWallet(body.walletAddress);
  const avatarId = typeof body.avatarId === "string" ? body.avatarId : "";
  if (!isAvatarId(avatarId)) {
    return NextResponse.json({ error: "unknown avatar" }, { status: 400 });
  }

  const result = await getOrCreateUser({ did, wallet });
  if (!result) {
    return NextResponse.json({ error: "no identity" }, { status: 400 });
  }

  await setAvatar(result.user.id, avatarId);
  const { awarded, xp } = await awardXp(result.user.id, "avatar_set", null);
  return NextResponse.json({
    ...toProfile({ ...result.user, avatar_id: avatarId, xp }),
    rewards: awarded > 0 ? [{ kind: "avatar_set", amount: awarded }] : [],
  });
}
