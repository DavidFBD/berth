import { NextResponse } from "next/server";
import { getSql } from "@/lib/server/db";
import { scrubPersonal } from "@/lib/staff/mask";
import { staffFromCookie } from "@/lib/server/staff-gate";
import { cookieFromHeader, staffCookieName } from "@/lib/server/staff-session";

/**
 * The campaigns routes' gate (app/api/staff/campaigns) and the shared
 * writer of staff_audit, on the staff area's one session system
 * (docs/adr/0008-staff-area.md, lib/server/staff-gate).
 *
 * Staff means: a live staff session (staff_sessions, its cookie minted at
 * POST /api/staff/session from a Privy email sign in) for an account on
 * STAFF_ADMIN_IDS. A Privy token alone, or a wallet session, is never a
 * staff pass. Fresh means the one rule of the whole staff area: a code
 * entered on the account's email within 15 minutes (Privy's
 * latest_verified_at for that address, read when the session was made or
 * renewed; lib/server/privy emailProofAt).
 *
 * Every refusal is the same 404 (the proxy answers it before a route is
 * reached), so the pages say nothing about themselves.
 */

export type StaffRole = "admin";

export type StaffSession = { userId: string; role: StaffRole };

export type StaffGate = { ok: true; staff: StaffSession } | { ok: false; response: NextResponse };

/** The admin allowlist, read at every call so a changed env takes effect at once. */
export function staffAdminIds(env: Record<string, string | undefined> = process.env): Set<string> {
  return new Set(
    (env.STAFF_ADMIN_IDS ?? "")
      .split(",")
      .map((id) => id.trim().toLowerCase())
      .filter((id) => /^[0-9a-f-]{36}$/.test(id)),
  );
}

const refused = (): StaffGate => ({ ok: false, response: NextResponse.json({ error: "not found" }, { status: 404 }) });

async function sessionOf(request: Request) {
  try {
    return await staffFromCookie(cookieFromHeader(request.headers.get("cookie"), staffCookieName()));
  } catch {
    return null;
  }
}

export async function requireStaff(
  request: Request,
  role: StaffRole,
  env: Record<string, string | undefined> = process.env,
): Promise<StaffGate> {
  const staff = await sessionOf(request);
  if (!staff || staff.role !== "admin" || !staffAdminIds(env).has(staff.userId)) return refused();
  return { ok: true, staff: { userId: staff.userId, role } };
}

/** How recent the email code must be for a staff act that matters: the staff area's one rule (lib/server/staff-session STAFF_FRESH_MS). */
export const FRESH_STAFF_MS = 15 * 60_000;

export type FreshStaffGate = StaffGate | { ok: false; stale: true; response: NextResponse };

/**
 * requireStaff, plus a fresh proof: an email code entered on the account's
 * email in the last 15 minutes (the session's auth_at). Staff without one
 * get `stale`, so the page can ask them to sign in again by email.
 */
export async function requireFreshStaff(
  request: Request,
  role: StaffRole,
  env: Record<string, string | undefined> = process.env,
): Promise<FreshStaffGate> {
  const staff = await sessionOf(request);
  if (!staff || staff.role !== "admin" || !staffAdminIds(env).has(staff.userId)) return refused();
  // The staff area's one answer to a proof that is too old: 401 `stale` (as staffRoute).
  if (!staff.fresh) return { ok: false, stale: true, response: NextResponse.json({ error: "stale" }, { status: 401 }) };
  return { ok: true, staff: { userId: staff.userId, role } };
}

/**
 * One row per staff action, refused attempts included. `detail` never holds a
 * secret, and any email or wallet in `target` or `detail` is masked here,
 * whoever calls (lib/staff/mask scrubPersonal).
 */
export async function staffAudit(entry: {
  staffUserId: string | null;
  action: string;
  target?: string | null;
  detail?: Record<string, unknown>;
}): Promise<void> {
  await getSql().query(`insert into staff_audit (staff_user_id, action, target, detail) values ($1, $2, $3, $4::jsonb)`, [
    entry.staffUserId,
    entry.action,
    entry.target ? scrubPersonal(entry.target).slice(0, 200) : null,
    JSON.stringify(scrubPersonal(entry.detail ?? {})),
  ]);
}
