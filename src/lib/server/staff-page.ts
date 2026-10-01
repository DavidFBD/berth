import { hkdfSync } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";

/**
 * The staff pages' own pass, so a page under /staff can answer Next's 404
 * on the server to everyone else, as an unknown path does. Berth signs in
 * with a bearer token the server never sees on a page load, so the pass
 * is a short signed cookie, set on the profile sync of an account on
 * STAFF_ADMIN_IDS (app/api/profile) and read by the page. It opens the
 * page only: every read and write still goes through requireStaff with
 * the bearer token, and the list is asked again on every page load. It
 * is read by the proxy (src/proxy.ts), so it imports nothing beyond jose:
 * the list is parsed here the way lib/server/staff-auth staffAdminIds does.
 * Sign out clears it (app/api/session/sign-out).
 */

export const STAFF_PAGE_COOKIE = "berth_staff";
/** Where a refused staff page is rewritten to: an address Berth has no page for, so its 404 is any unknown path's. */
export const NOWHERE_PATH = "/_berth/not-a-page";

function adminIds(env: Record<string, string | undefined>): Set<string> {
  return new Set(
    (env.STAFF_ADMIN_IDS ?? "")
      .split(",")
      .map((id) => id.trim().toLowerCase())
      .filter((id) => /^[0-9a-f-]{36}$/.test(id)),
  );
}
const TTL_SECONDS = 12 * 3600;

function key(): Uint8Array {
  const secret = process.env.SESSION_SECRET ?? process.env.PRIVY_APP_SECRET;
  if (!secret) throw new Error("staff page pass needs SESSION_SECRET (or PRIVY_APP_SECRET)");
  return new Uint8Array(hkdfSync("sha256", secret, "berth", "staff-page-v1", 32));
}

export async function issueStaffPagePass(userId: string): Promise<string> {
  return new SignJWT({ purpose: "staff-page", sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(key());
}

/** The cookie's options: sent to the staff pages only, never readable by script. */
export const STAFF_PAGE_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/staff",
  maxAge: TTL_SECONDS,
};

/** Whether a cookie value is a live pass for an account still on the list. */
export async function staffPagePass(value: string | undefined, env: Record<string, string | undefined> = process.env): Promise<boolean> {
  if (!value) return false;
  try {
    const { payload } = await jwtVerify(value, key());
    return payload.purpose === "staff-page" && typeof payload.sub === "string" && adminIds(env).has(payload.sub.toLowerCase());
  } catch {
    return false;
  }
}
