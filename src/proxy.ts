import { NextResponse, type NextRequest } from "next/server";
import { NOWHERE_PATH, STAFF_PAGE_COOKIE, staffPagePass } from "@/lib/server/staff-page";

/**
 * The staff campaigns page's outer door, with next.config's rewrite. A
 * request with no staff pass (lib/server/staff-page) is rewritten there
 * to an address Berth has no page for, and gets exactly what any unknown
 * address gets: the same page, status and headers, byte for byte. One
 * with a pass that is not valid is rewritten here, to the same page. The page and its API check
 * again themselves (requireStaff on every call).
 */
export async function proxy(request: NextRequest) {
  const pass = request.cookies.get(STAFF_PAGE_COOKIE)?.value;
  // No pass at all: next.config's rewrite serves the unknown address, with
  // no header of the proxy's own, so the answer is an unknown path's exactly.
  if (pass === undefined) return NextResponse.next();
  if (await staffPagePass(pass).catch(() => false)) return NextResponse.next();
  // A pass that is not valid (forged, expired, off the list): the same page,
  // though Next names its rewrite in a header here.
  return NextResponse.rewrite(new URL(NOWHERE_PATH, request.url));
}

export const config = {
  matcher: ["/staff/campaigns", "/staff/campaigns/:path*"],
};
