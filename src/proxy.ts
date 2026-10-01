import { NextResponse, type NextRequest } from "next/server";
import { REFUSED_HEADER } from "@/lib/nowhere";
import { cookieFromHeader, staffCookieName, staffRoleFor } from "@/lib/server/staff-session";
import { staffFromCookie } from "@/lib/server/staff-gate";
import { verifyPrivyToken } from "@/lib/server/privy";
import { accountForDid } from "@/lib/server/accounts";

/**
 * The staff area's outer door (docs/adr/0008-staff-area.md), pages and API,
 * the campaigns page and its route included. With next.config:
 *
 * - Neither a staff session cookie nor a bearer token: passed on untouched,
 *   and next.config's beforeFiles rewrite serves the address Berth has no
 *   page for, inside Next's own router, so the answer is an unknown path's
 *   exactly: status, headers, body, RSC requests too. The proxy adds
 *   nothing of its own.
 * - A live staff session (lib/server/staff-gate staffFromCookie) for an
 *   account on an allowlist: on to the page or route, which checks again,
 *   with the strict headers.
 * - POST /api/staff/session with a valid Privy token of an account on an
 *   allowlist: the door, which mints the session.
 * - Anything else (a forged, ended or revoked cookie, a token that is not
 *   staff, a token on another path): refused (refuse), and next.config
 *   serves it as the unknown address, exactly as above.
 */

export const STAFF_HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

async function allowed(request: NextRequest): Promise<boolean> {
  try {
    if (await staffFromCookie(cookieFromHeader(request.headers.get("cookie"), staffCookieName()))) return true;
    if (request.nextUrl.pathname === "/api/staff/session" && request.method === "POST") {
      const token = await verifyPrivyToken(request.headers.get("authorization")).catch(() => null);
      const account = token ? await accountForDid(token.did) : undefined;
      return Boolean(account && staffRoleFor(account.id));
    }
  } catch {
    // A database or Privy that cannot be asked opens nothing.
  }
  return false;
}


/**
 * A refused request goes on, marked, with its credentials taken off, and
 * next.config's beforeFiles rule (has the marker) serves it as the address
 * Berth has no page for, inside Next's own router: the same status,
 * headers and body as any unknown path, RSC requests included, with no
 * header of the proxy's own and no request of its own.
 */
function refuse(request: NextRequest): NextResponse {
  const headers = new Headers(request.headers);
  headers.delete("cookie");
  headers.delete("authorization");
  headers.set(REFUSED_HEADER, "1");
  return NextResponse.next({ request: { headers } });
}

export async function proxy(request: NextRequest) {
  const hasCookie = cookieFromHeader(request.headers.get("cookie"), staffCookieName()) !== null;
  // Nothing to judge: next.config's rewrite answers it, as an unknown path.
  if (!hasCookie && !request.headers.get("authorization")) return NextResponse.next();
  if (!(await allowed(request))) return refuse(request);
  const response = NextResponse.next();
  for (const [key, value] of Object.entries(STAFF_HEADERS)) response.headers.set(key, value);
  return response;
}

// Literal, as Next reads it at build time; the same list as lib/nowhere STAFF_SOURCES (a test holds them together).
export const config = {
  matcher: ["/staff", "/staff/:path*", "/api/staff", "/api/staff/:path*"],
};
