import { NextResponse, type NextRequest } from "next/server";
import { verifyPrivyAuth } from "@/lib/server/privy";
import {
  awardXp,
  getOrCreateUser,
  normalizeWallet,
  toProfile,
  type UserRow,
} from "@/lib/server/accounts";
import type { RewardList } from "@/lib/profile-types";
import type { XpKind } from "@/lib/xp";

/**
 * The rewards endpoint module: everything between "an HTTP request arrived"
 * and "a profile JSON went back", shared by every XP route. A route keeps
 * only what is genuinely its own — its body fields and any pre-check — and
 * delegates the ritual: read the caller, resolve the account, award,
 * respond.
 */

/** Whom this request speaks for, before any database work. */
export type RewardsCaller = {
  did: string | null;
  wallet: string | null;
  /** Parsed JSON body; each route reads its own fields from it. */
  body: Record<string, unknown>;
};

export type CallerResult =
  | { ok: true; caller: RewardsCaller }
  | { ok: false; response: NextResponse };

/**
 * Auth prologue plus body parse. A present-but-invalid token is a 401,
 * never a silent downgrade to anonymous; a missing one is a wallet-only
 * caller, trusted by address — a recorded product decision (the stakes are
 * teapots).
 */
export async function readRewardsCaller(
  request: NextRequest,
): Promise<CallerResult> {
  let did: string | null;
  try {
    did = await verifyPrivyAuth(request.headers.get("authorization"));
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "invalid token" }, { status: 401 }),
    };
  }
  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  return {
    ok: true,
    caller: { did, wallet: normalizeWallet(body.walletAddress), body },
  };
}

export type UserResult =
  | { ok: true; user: UserRow; created: boolean }
  | { ok: false; response: NextResponse };

/** The caller's account row, created on first sight. 400 when there is nobody to be. */
export async function resolveRewardsUser(
  caller: RewardsCaller,
): Promise<UserResult> {
  const result = await getOrCreateUser({
    did: caller.did,
    wallet: caller.wallet,
  });
  if (!result) {
    return {
      ok: false,
      response: NextResponse.json({ error: "no identity" }, { status: 400 }),
    };
  }
  return { ok: true, ...result };
}

/**
 * The one envelope strategy: patch the row already in hand with whatever the
 * route just wrote (always the fresh XP total, sometimes an avatar) — never
 * a second read to learn what we ourselves changed.
 */
export function rewardsResponse(
  user: UserRow,
  patch: Partial<UserRow>,
  rewards: RewardList,
): NextResponse {
  return NextResponse.json({ ...toProfile({ ...user, ...patch }), rewards });
}

/** Award one kind and respond. `patch` carries any extra route write (e.g. avatar_id). */
export async function awardAndRespond(
  user: UserRow,
  kind: XpKind,
  ref: string | null,
  patch: Partial<UserRow> = {},
): Promise<NextResponse> {
  const { awarded, xp } = await awardXp(user.id, kind, ref);
  return rewardsResponse(
    user,
    { ...patch, xp },
    awarded > 0 ? [{ kind, amount: awarded }] : [],
  );
}
