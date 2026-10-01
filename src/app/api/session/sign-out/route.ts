import { NextResponse } from "next/server";
import { cookieFromHeader, readStaffSessionToken, staffCookieName, staffCookieOptions, staffSessionKey } from "@/lib/server/staff-session";
import { revokeStaffSession } from "@/lib/server/staff-sessions";

/**
 * Sign out's server half (components/sign-out-sweep, and the staff area's
 * own Leave button): ends this browser's staff session, if it has one
 * (staff_sessions, docs/adr/0008-staff-area.md), and clears its cookie, so
 * the next person on a shared browser cannot open even the empty shell.
 * Asks nothing and says nothing; any browser may call it, and every
 * browser gets the same empty 204.
 */
export async function POST(request: Request) {
  const claims = await readStaffSessionToken(cookieFromHeader(request.headers.get("cookie"), staffCookieName()), staffSessionKey());
  if (claims) await revokeStaffSession(claims.sessionId).catch(() => false);
  const response = new NextResponse(null, { status: 204 });
  if (claims) response.cookies.set(staffCookieName(), "", staffCookieOptions(process.env, 0));
  return response;
}
