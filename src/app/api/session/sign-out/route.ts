import { NextResponse } from "next/server";
import { STAFF_PAGE_COOKIE, STAFF_PAGE_COOKIE_OPTIONS } from "@/lib/server/staff-page";

/**
 * Sign out's server half: clears the staff pages' pass (lib/server/staff-page),
 * so the next person on a shared browser cannot open even the empty shell.
 * Asks nothing and says nothing; any browser may call it.
 */
export async function POST() {
  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(STAFF_PAGE_COOKIE, "", { ...STAFF_PAGE_COOKIE_OPTIONS, maxAge: 0 });
  return response;
}
