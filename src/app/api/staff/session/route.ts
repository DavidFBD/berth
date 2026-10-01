import { notFound } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";
import { accountForDid } from "@/lib/server/accounts";
import { emailProofAt, verifyPrivyToken } from "@/lib/server/privy";
import { getSql } from "@/lib/server/db";
import { readStaff, recordStaff, sameOrigin, STAFF_NO_STORE, STAFF_OTHER_METHODS, staffAreaOn, staffRoleFor, staffRoute } from "@/lib/server/staff-gate";
import { mintStaffCookie, staffCookieName, staffCookieOptions, staffFresh, staffSessionKey } from "@/lib/server/staff-session";
import { createStaffSession, renewStaffSession, revokeStaffSession } from "@/lib/server/staff-sessions";

export const dynamic = "force-dynamic";

/**
 * POST /api/staff/session, with the Privy token as a Bearer: the door into
 * the staff area (docs/adr/0008-staff-area.md). The proxy lets the request
 * this far only for a valid token of an account on an allowlist; here
 * Privy is asked when a code to the account's own email was last entered
 * (an account with no email gets nothing: wallet sign ins never open the
 * area). A browser that already holds a live session for the same
 * account renews it (a later end, the latest proof); otherwise a new
 * session row is made. The session ends with the token it came from, so a
 * Privy session that cannot refresh ends it within the hour.
 *
 * DELETE ends this browser's session (the staff Sign out, and a Berth sign
 * out, components/staff/fresh). Anyone without a live session never gets
 * here: the proxy answers them with the unknown address 404.
 */

export async function POST(request: NextRequest) {
  const key = staffSessionKey();
  if (!staffAreaOn() || !key || !sameOrigin(request)) notFound();
  const token = await verifyPrivyToken(request.headers.get("authorization")).catch(() => null);
  if (!token) notFound();
  const account = await accountForDid(token.did).catch(() => undefined);
  const role = account ? staffRoleFor(account.id) : null;
  if (!account || !role) notFound();
  // The code must have gone to the account's own email (its primary
  // identity, else users.email): a wallet sign in, or Privy not answering,
  // makes no session.
  const emails = (await getSql().query(
    `select coalesce((select value from user_identities where user_id = $1 and kind = 'email' and is_primary limit 1),
                     (select lower(btrim(email)) from users where id = $1)) as email`,
    [account.id],
  )) as { email: string | null }[];
  const authAt = await emailProofAt(token.did, emails[0]?.email);
  if (authAt === null) notFound();
  const current = await readStaff(request).catch(() => null);
  const session =
    (current?.userId === account.id && current.sessionId ? await renewStaffSession(current.sessionId, account.id, authAt, token.expiresAt) : null) ??
    (await createStaffSession(account.id, authAt, token.expiresAt));
  if (!current || current.sessionId !== session.id) {
    try {
      await recordStaff(account.id, "session_started", `user:${account.id}`, { role, fresh: staffFresh(authAt), session: session.id });
    } catch {
      await revokeStaffSession(session.id).catch(() => undefined);
      return NextResponse.json({ error: "failed" }, { status: 500, headers: STAFF_NO_STORE });
    }
  }
  const response = NextResponse.json({ ok: true, role, fresh: staffFresh(authAt) }, { headers: STAFF_NO_STORE });
  response.cookies.set(staffCookieName(), await mintStaffCookie({ sessionId: session.id, expiresAt: session.expiresAt }, key), staffCookieOptions(process.env, Math.max(1, Math.floor((session.expiresAt - Date.now()) / 1000))));
  return response;
}

export const DELETE = staffRoute(async (staff) => {
  if (staff.sessionId) {
    await revokeStaffSession(staff.sessionId);
    await recordStaff(staff, "session_ended", `user:${staff.userId}`, { session: staff.sessionId });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(staffCookieName(), "", staffCookieOptions(process.env, 0));
  return response;
});

export const { GET, PUT, PATCH, HEAD, OPTIONS } = STAFF_OTHER_METHODS;
