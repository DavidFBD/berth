import { NextResponse, type NextRequest } from "next/server";
import { MODES } from "@/lib/copy";
import { verifyPrivyAuth } from "@/lib/server/privy";
import {
  awardXp,
  getOrCreateUser,
  normalizeWallet,
  toProfile,
} from "@/lib/server/accounts";

/**
 * A first taste of a mode. The dedup ref scopes the award to (account,
 * mode): flipping back and forth pays nothing after the first sip, which is
 * the whole abuse story — the ceiling is modes × 10 XP per account.
 */
export async function POST(request: NextRequest) {
  let did: string | null;
  try {
    did = await verifyPrivyAuth(request.headers.get("authorization"));
  } catch {
    return NextResponse.json({ error: "invalid token" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    mode?: unknown;
    walletAddress?: unknown;
  };
  const wallet = normalizeWallet(body.walletAddress);
  const mode = typeof body.mode === "string" ? body.mode : "";
  if (!MODES.some((meta) => meta.id === mode)) {
    return NextResponse.json({ error: "unknown mode" }, { status: 400 });
  }

  const result = await getOrCreateUser({ did, wallet });
  if (!result) {
    return NextResponse.json({ error: "no identity" }, { status: 400 });
  }

  const { awarded, xp } = await awardXp(
    result.user.id,
    "theme_tried",
    `${result.user.id}:${mode}`,
  );
  return NextResponse.json({
    ...toProfile({ ...result.user, xp }),
    rewards: awarded > 0 ? [{ kind: "theme_tried", amount: awarded }] : [],
  });
}
