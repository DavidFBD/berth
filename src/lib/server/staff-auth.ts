import { NextResponse } from "next/server";
import { getSql } from "@/lib/server/db";
import { fetchPrivyEmailProofs, verifyPrivyAuth } from "@/lib/server/privy";
import { readWalletSession } from "@/lib/server/wallet-session";
import { accountForDid, accountForWallet, normalizeWallet } from "@/lib/server/accounts";
import { signedBeforeMerge } from "@/lib/server/rewards-route";

/**
 * Who may use the staff pages (/staff), and the record of what they did.
 * The one gate every staff route asks, and the one writer of staff_audit.
 *
 * The rule, for now: the signed in account's id is in STAFF_ADMIN_IDS
 * (comma separated users.id values). Not the @sodax.com email rule
 * (lib/server/social/handles isStaff): that one is for reserved usernames,
 * and is far too broad for people's data and money. Signed in means what
 * every rewards route means, no looser: a verified Privy token, or a SIWE
 * wallet session for the account's home wallet that was not signed before
 * a merge moved it. Nobody is created here, and an id that has been merged
 * into another account is not the survivor's pass.
 *
 * Every refusal is the same 404 (the routes answer Next's own not found),
 * so the pages say nothing about themselves. A signed in account that is
 * not staff and asks anyway leaves a row in staff_audit (staff.denied).
 */

export type StaffRole = "admin";

export type StaffSession = { userId: string; role: StaffRole };

export type StaffGate = { ok: true; staff: StaffSession } | { ok: false; response: NextResponse };

/** The allowlist, read at every call so a changed env takes effect at once. */
export function staffAdminIds(env: Record<string, string | undefined> = process.env): Set<string> {
  return new Set(
    (env.STAFF_ADMIN_IDS ?? "")
      .split(",")
      .map((id) => id.trim().toLowerCase())
      .filter((id) => /^[0-9a-f-]{36}$/.test(id)),
  );
}

const refused = (): StaffGate => ({ ok: false, response: NextResponse.json({ error: "not found" }, { status: 404 }) });

type SignedIn = { userId: string; via: "privy" | "wallet"; did: string | null; email: string | null };

/** The account this request speaks for, without creating one; null for anyone not signed in. */
async function signedInAccount(request: Request): Promise<SignedIn | null> {
  const authorization = request.headers.get("authorization");
  let did: string | null = null;
  try {
    did = await verifyPrivyAuth(authorization);
  } catch {
    return null;
  }
  if (did) {
    const account = await accountForDid(did);
    if (!account) return null;
    return { userId: account.id, via: "privy", did, email: account.email?.trim().toLowerCase() ?? null };
  }
  const token = request.headers.get("x-wallet-session");
  const session = token ? await readWalletSession(token) : null;
  const wallet = session ? normalizeWallet(session.address) : null;
  if (!session || !wallet || (await signedBeforeMerge(wallet, session.issuedAt))) return null;
  const account = await accountForWallet(wallet);
  // The home wallet only, as the account's own sign in: a linked second wallet is no staff pass.
  if (!account || account.wallet_address !== wallet) return null;
  return { userId: account.id, via: "wallet", did: null, email: null };
}

async function gate(request: Request, role: StaffRole, env: Record<string, string | undefined>): Promise<{ gate: StaffGate; signedIn: SignedIn | null }> {
  const allowed = staffAdminIds(env);
  let signedIn: SignedIn | null = null;
  try {
    signedIn = await signedInAccount(request);
  } catch {
    return { gate: refused(), signedIn: null };
  }
  if (!signedIn || !allowed.has(signedIn.userId.toLowerCase())) {
    if (signedIn) {
      // A signed in account that is not staff, asking anyway: kept, never answered.
      let path = "";
      try {
        path = new URL(request.url).pathname;
      } catch {
        path = "";
      }
      await staffAudit({ staffUserId: signedIn.userId, action: "staff.denied", target: path, detail: { role } }).catch(() => undefined);
    }
    return { gate: refused(), signedIn };
  }
  return { gate: { ok: true, staff: { userId: signedIn.userId, role } }, signedIn };
}

export async function requireStaff(
  request: Request,
  role: StaffRole,
  env: Record<string, string | undefined> = process.env,
): Promise<StaffGate> {
  return (await gate(request, role, env)).gate;
}

/** How recent a sign in must be for a staff act that matters (activate, approve, reject, mark paid, payout wallets). */
export const FRESH_STAFF_MS = 15 * 60_000;

export type FreshStaffGate = StaffGate | { ok: false; stale: true; response: NextResponse };

/**
 * requireStaff, plus a fresh sign in by email: Privy's own record of the
 * account's verified email (users.email) shows a code entered within
 * FRESH_STAFF_MS (the email account's latest_verified_at, read from
 * Privy's API on the server). A Privy access token's issue time proves
 * nothing, since a session mints new ones silently for weeks; a Google
 * login, any other Privy method and a wallet session are never fresh
 * enough. Anyone who is not staff gets the same 404 as requireStaff;
 * staff without a fresh proof get `stale`, so the page can ask them to
 * sign in again by email. Privy's API not answering is stale too.
 */
export async function requireFreshStaff(
  request: Request,
  role: StaffRole,
  env: Record<string, string | undefined> = process.env,
  now: number = Date.now(),
  proofs: (did: string) => Promise<{ address: string; at: number | null }[] | null> = fetchPrivyEmailProofs,
): Promise<FreshStaffGate> {
  const result = await gate(request, role, env);
  if (!result.gate.ok) return result.gate;
  const signedIn = result.signedIn!;
  let fresh = false;
  if (signedIn.via === "privy" && signedIn.did && signedIn.email) {
    const list = await proofs(signedIn.did).catch(() => null);
    const proof = list?.find((entry) => entry.address === signedIn.email);
    fresh = proof?.at != null && now - proof.at <= FRESH_STAFF_MS && proof.at <= now + 60_000;
  }
  if (!fresh) {
    return { ok: false, stale: true, response: NextResponse.json({ error: "fresh_session" }, { status: 403 }) };
  }
  return result.gate;
}

/** One row per staff action, refused attempts included. `detail` never holds a secret. */
export async function staffAudit(entry: {
  staffUserId: string | null;
  action: string;
  target?: string | null;
  detail?: Record<string, unknown>;
}): Promise<void> {
  await getSql().query(`insert into staff_audit (staff_user_id, action, target, detail) values ($1, $2, $3, $4::jsonb)`, [
    entry.staffUserId,
    entry.action,
    entry.target ?? null,
    JSON.stringify(entry.detail ?? {}),
  ]);
}
