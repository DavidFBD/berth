import { NextResponse, type NextRequest } from "next/server";
import { fetchPrivyWallet, verifyPrivyAuth } from "@/lib/server/privy";
import { verifyWalletSession } from "@/lib/server/wallet-session";
import {
  awardXp,
  flushUnannounced,
  getOrCreateUser,
  normalizeWallet,
  IdentityUnavailableError,
  WalletCoolingDownError,
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
 * Auth prologue plus body parse. Every identity is now verified, never
 * asserted: a Privy caller's wallet comes from Privy's own records (the
 * embedded address, resolved server-side), and a wallet-only caller must
 * present a SIWE session token for the address it claims to be. The old
 * trusted-by-address guest path is gone — a request with neither proof
 * gets a 401 and the client knows to run the SIWE handshake.
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

  if (did) {
    const lookup = await fetchPrivyWallet(did);
    if (!lookup.ok) {
      // Never guess who this is: see PrivyWalletLookup.
      return {
        ok: false,
        response: NextResponse.json({ error: "identity lookup failed" }, { status: 503 }),
      };
    }
    return { ok: true, caller: { did, wallet: normalizeWallet(lookup.address), body } };
  }

  const sessionToken = request.headers.get("x-wallet-session");
  const wallet = sessionToken
    ? normalizeWallet(await verifyWalletSession(sessionToken))
    : null;
  if (!wallet) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "wallet session required" },
        { status: 401 },
      ),
    };
  }
  return { ok: true, caller: { did: null, wallet, body } };
}

export type UserResult =
  | { ok: true; user: UserRow; created: boolean }
  | { ok: false; response: NextResponse };

/** The caller's account row, created on first sight. 400 when there is nobody to be. */
export async function resolveRewardsUser(
  caller: RewardsCaller,
): Promise<UserResult> {
  let result: Awaited<ReturnType<typeof getOrCreateUser>>;
  try {
    result = await getOrCreateUser({
      did: caller.did,
      wallet: caller.wallet,
    });
  } catch (error) {
    if (error instanceof IdentityUnavailableError) {
      // Never guess who this is (as with a failed Privy lookup).
      return {
        ok: false,
        response: NextResponse.json({ error: "identity lookup failed" }, { status: 503 }),
      };
    }
    if (!(error instanceof WalletCoolingDownError)) throw error;
    // An address unlinked from an account days ago: it joins nothing yet.
    return {
      ok: false,
      response: NextResponse.json({ error: "wallet cooling down" }, { status: 409 }),
    };
  }
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

/**
 * Award one kind and respond. `patch` carries any extra route write (e.g.
 * avatar_id). Every rewards response also carries the account's parked
 * rewards (announced=false, e.g. a held_30_days paid by the cron): the new
 * total already includes them, so a rank they crossed is announced with
 * this total rather than slipping by between two totals. Flushing is a one
 * shot flip, so the profile sync that follows reports nothing twice.
 */
export async function awardAndRespond(
  user: UserRow,
  kind: XpKind,
  ref: string | null,
  patch: Partial<UserRow> = {},
): Promise<NextResponse> {
  const { awarded, xp } = await awardXp(user.id, kind, ref);
  const rewards: RewardList = awarded > 0 ? [{ kind, amount: awarded }] : [];
  rewards.push(...(await flushUnannounced(user.id)));
  return rewardsResponse(user, { ...patch, xp }, rewards);
}
