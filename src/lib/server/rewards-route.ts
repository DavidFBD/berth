import { NextResponse, type NextRequest } from "next/server";
import { fetchPrivyWallet, verifyPrivyAuth } from "@/lib/server/privy";
import { readWalletSession } from "@/lib/server/wallet-session";
import { walletSessionRevoked } from "@/lib/server/wallet-session-revocations";
import { getSql } from "@/lib/server/db";
import { AVAILABLE, requestAvailability, unavailableResponse, type Availability } from "@/lib/server/availability";
import { detectFamily, toCaip10 } from "@/lib/identity/caip";
import {
  awardXp,
  flushUnannounced,
  getOrCreateUser,
  normalizeWallet,
  IdentityUnavailableError,
  NewAccountUnavailableError,
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
  /**
   * Whether Berth can start something new for this request's country
   * (lib/server/availability). Absent reads as available. It decides
   * whether a new account may be made here, and the routes that start a
   * buy, a limit buy or a plan read it; never stored.
   */
  availability?: Availability;
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
  // From a comprehensively sanctioned place no account is served at all,
  // an existing one included (lib/server/availability refuseSanctioned):
  // refused before anyone is looked up.
  const availability = availabilityOf(request);
  if (!availability.available && availability.reason === "sanctions") {
    return { ok: false, response: unavailableResponse(availability) };
  }
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
    return { ok: true, caller: { did, wallet: normalizeWallet(lookup.address), body, availability } };
  }

  const sessionToken = request.headers.get("x-wallet-session");
  const session = sessionToken ? await readWalletSession(sessionToken) : null;
  const wallet = session ? normalizeWallet(session.address) : null;
  let revoked = false;
  try {
    revoked = session ? await walletSessionRevoked(session.jti) : false;
  } catch (error) {
    // Unknown is neither yes nor no: 503 keeps the browser's session (it
    // forgets only on a 401) and the read is tried again later.
    console.error("[wallet-session] revocation read failed", error);
    return {
      ok: false,
      response: NextResponse.json({ error: "session check unavailable" }, { status: 503 }),
    };
  }
  if (
    !wallet ||
    (session && (await signedBeforeMerge(wallet, session.issuedAt))) ||
    // Signed out on the server (lib/server/wallet-session-revocations).
    revoked
  ) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "wallet session required" },
        { status: 401 },
      ),
    };
  }
  return { ok: true, caller: { did: null, wallet, body, availability } };
}

function availabilityOf(request: NextRequest): Availability {
  return requestAvailability(request.headers, { url: request.url });
}

/**
 * The refusal a route answers when this caller may not start something
 * new here, else null. Selling, withdrawing and reading never ask.
 */
export function refuseWhereUnavailable(caller: RewardsCaller): NextResponse | null {
  const availability = caller.availability ?? AVAILABLE;
  return availability.available ? null : unavailableResponse(availability);
}

/**
 * Whether a merge moved this wallet onto another account after the session
 * was signed (user_identities.merged_at): such a session was made for the
 * absorbed account, and it ends here. The browser signs in again and lands
 * on the survivor. Seconds, as the token's iat is. A failed read lets the
 * session through, as before phase 3: the account it resolves to is the
 * survivor either way.
 */
export async function signedBeforeMerge(wallet: string, issuedAt: number): Promise<boolean> {
  const family = detectFamily(wallet);
  const value = family ? toCaip10(family, wallet) : null;
  if (!value) return false;
  try {
    const rows = (await getSql().query(
      `select merged_at from user_identities where kind = 'wallet' and value = $1 and merged_at is not null`,
      [value],
    )) as { merged_at: string | Date }[];
    const mergedAt = rows[0] ? new Date(rows[0].merged_at).getTime() : null;
    // The same second counts as before: refusing a session signed in the
    // merge's own second costs one more signature, never an account.
    return mergedAt !== null && Math.floor(issuedAt / 1000) <= Math.floor(mergedAt / 1000);
  } catch {
    return false;
  }
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
      // Where Berth is not available an existing account is found as
      // always (someone who travels can still see, sell and withdraw),
      // and no new one is made.
      mayCreate: (caller.availability ?? AVAILABLE).available,
    });
  } catch (error) {
    if (error instanceof NewAccountUnavailableError) {
      return { ok: false, response: unavailableResponse(caller.availability ?? AVAILABLE) };
    }
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
