import { NextResponse } from "next/server";
import { recordStaff, STAFF_OTHER_METHODS, staffRoute } from "@/lib/server/staff-gate";
import { staffCookieName, staffCookieOptions } from "@/lib/server/staff-session";
import { revokeAllStaffSessions } from "@/lib/server/staff-sessions";

export const dynamic = "force-dynamic";

/** POST /api/staff/session/everywhere: "Sign out everywhere", every live session of this staff member, audited. */
export const POST = staffRoute(async (staff) => {
  const ended = await revokeAllStaffSessions(staff.userId);
  await recordStaff(staff, "sessions_revoked_all", `user:${staff.userId}`, { ended });
  const response = NextResponse.json({ ok: true, ended });
  response.cookies.set(staffCookieName(), "", staffCookieOptions(process.env, 0));
  return response;
});

export const { GET, PUT, PATCH, DELETE, HEAD, OPTIONS } = STAFF_OTHER_METHODS;
