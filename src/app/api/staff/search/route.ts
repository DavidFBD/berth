import { NextResponse } from "next/server";
import { STAFF_OTHER_METHODS, staffRoute } from "@/lib/server/staff-gate";
import { sealSearch, staffSessionKey } from "@/lib/server/staff-session";
import { classifySearch } from "@/lib/server/staff/users";

export const dynamic = "force-dynamic";

const FILTERS = ["stage", "from", "to", "email", "referred", "hidden", "ineligible", "campaign"] as const;

/**
 * POST /api/staff/search (the Users form): back to /staff/users with the
 * filters in the address, and a search for anything personal sealed
 * (staff-session sealSearch) rather than written there in the clear. A
 * username prefix is public by design and stays readable.
 */
export const POST = staffRoute(async (staff, request) => {
  const form = await request.formData().catch(() => null);
  const target = new URL("/staff/users", request.url);
  if (form) {
    for (const key of FILTERS) {
      const value = form.get(key);
      if (typeof value === "string" && value.trim()) target.searchParams.set(key, value.trim().slice(0, 40));
    }
    const q = form.get("q");
    if (typeof q === "string" && q.trim()) {
      const kind = classifySearch(q).kind;
      if (kind === "username") target.searchParams.set("q", q.trim().slice(0, 30));
      else target.searchParams.set("find", await sealSearch(q.trim().slice(0, 200), staffSessionKey()!, staff.userId));
    }
  }
  return NextResponse.redirect(target, 303);
});

export const { GET, PUT, PATCH, DELETE, HEAD, OPTIONS } = STAFF_OTHER_METHODS;
