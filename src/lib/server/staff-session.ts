import { jwtVerify, SignJWT } from "jose";
import { staffCookieNameFor } from "@/lib/nowhere";

/**
 * The staff session cookie (docs/adr/0008-staff-area.md), minted by POST
 * /api/staff/session after a Privy token and the allowlist both say yes,
 * so server components can know who is asking without the Authorization
 * header a page navigation never carries.
 *
 * The cookie carries only a signed session id. The row it names
 * (staff_sessions, lib/server/staff-sessions) says whose it is, when it
 * ends and when the email code was last entered (Privy's
 * latest_verified_at; a Privy token's own `iat` is not used, since Privy
 * reissues tokens silently every hour). The role is read from the
 * environment on every request. Pure here: no database.
 *
 * HS256 under STAFF_SESSION_SECRET (at least 32 characters). Without it
 * the staff area does not exist: every page and route answers 404.
 */

/**
 * An account's staff role from the environment, read at every call:
 * STAFF_ADMIN_IDS (admin) and STAFF_VIEWER_IDS (viewer), comma separated
 * users.id values, parsed exactly as lib/server/staff-auth staffAdminIds
 * parses the admins (the tests hold the two together). Kept here, free of
 * the database, so the proxy can ask it too. An id on both lists is an
 * admin.
 */
export function staffRoleFor(userId: string, env: Record<string, string | undefined> = process.env): "admin" | "viewer" | null {
  const id = userId.trim().toLowerCase();
  const list = (raw: string | undefined) =>
    (raw ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter((value) => /^[0-9a-f-]{36}$/.test(value));
  if (list(env.STAFF_ADMIN_IDS).includes(id)) return "admin";
  if (list(env.STAFF_VIEWER_IDS).includes(id)) return "viewer";
  return null;
}

/** The longest a cookie or a session may last, renewals included. */
export const STAFF_SESSION_TTL_S = 12 * 60 * 60;
/** How recent the email code must be for a reveal or a write. */
export const STAFF_FRESH_MS = 15 * 60_000;

const ISSUER = "berth-staff";
const AUDIENCE = "berth-staff-area";

/** `__Host-` in production: Secure, Path=/, no Domain, so no subdomain can set or read it. */
export function staffCookieName(env: NodeJS.ProcessEnv = process.env): string {
  return staffCookieNameFor(env.NODE_ENV);
}

export function staffSessionKey(env: NodeJS.ProcessEnv = process.env): Uint8Array | null {
  const secret = env.STAFF_SESSION_SECRET?.trim();
  if (!secret || secret.length < 32) return null;
  return new TextEncoder().encode(secret);
}

/** What the cookie says: a session id, nothing else (the row in staff_sessions says the rest). */
export type StaffSessionClaims = {
  sessionId: string;
  /** When this cookie was minted, epoch ms. */
  issuedAt: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function mintStaffCookie(
  { sessionId, expiresAt }: { sessionId: string; expiresAt: number },
  key: Uint8Array,
  now = Date.now(),
): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(sessionId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(Math.floor(now / 1000))
    .setExpirationTime(Math.floor(Math.min(expiresAt, now + STAFF_SESSION_TTL_S * 1000) / 1000))
    .sign(key);
}

/** The session id of a validly signed, unexpired cookie, else null. Never throws. */
export async function readStaffSessionToken(token: string | null | undefined, key: Uint8Array | null, now = Date.now()): Promise<StaffSessionClaims | null> {
  if (!token || !key) return null;
  try {
    const { payload } = await jwtVerify(token, key, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["HS256"],
      currentDate: new Date(now),
    });
    if (typeof payload.sub !== "string" || !UUID.test(payload.sub)) return null;
    if (typeof payload.iat !== "number") return null;
    return { sessionId: payload.sub.toLowerCase(), issuedAt: payload.iat * 1000 };
  } catch {
    return null;
  }
}

/** Whether a proof at `authAt` still counts for a reveal or a write at `now`. */
export function staffFresh(authAt: number | null, now = Date.now()): boolean {
  return authAt !== null && authAt <= now + 60_000 && now - authAt <= STAFF_FRESH_MS;
}

/** The Set-Cookie attributes: HttpOnly, SameSite=Strict, Secure outside development. */
export function staffCookieOptions(env: NodeJS.ProcessEnv = process.env, maxAge = STAFF_SESSION_TTL_S) {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

/** One cookie's value out of a raw Cookie header. */
export function cookieFromHeader(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const at = part.indexOf("=");
    if (at < 0) continue;
    if (part.slice(0, at).trim() === name) {
      const value = part.slice(at + 1).trim();
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }
  return null;
}

/**
 * An exact search for something personal (an email, a wallet, an id),
 * sealed for the address bar: the Users form posts it and is sent back to
 * /staff/users?find=<sealed>, so the value never sits in a URL, a browser
 * history or a request log in the clear. Sealed for one staff member. A JWE (dir, A256GCM) under a key
 * derived from STAFF_SESSION_SECRET, good for ten minutes.
 */
export async function sealSearch(query: string, secret: Uint8Array, staffUserId: string, now = Date.now()): Promise<string> {
  const { EncryptJWT } = await import("jose");
  return new EncryptJWT({ q: query, sub: staffUserId })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt(Math.floor(now / 1000))
    .setExpirationTime(Math.floor(now / 1000) + 600)
    .encrypt(await searchKey(secret));
}

export async function openSearch(sealed: string | null | undefined, secret: Uint8Array | null, staffUserId: string, now = Date.now()): Promise<string | null> {
  if (!sealed || !secret) return null;
  try {
    const { jwtDecrypt } = await import("jose");
    const { payload } = await jwtDecrypt(sealed, await searchKey(secret), { currentDate: new Date(now) });
    // Bound to the staff member who searched: a shared link opens for nobody else.
    if (payload.sub !== staffUserId) return null;
    return typeof payload.q === "string" ? payload.q : null;
  } catch {
    return null;
  }
}

async function searchKey(secret: Uint8Array): Promise<Uint8Array> {
  const salted = new Uint8Array([...new TextEncoder().encode("berth-staff-search:"), ...secret]);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", salted));
}
