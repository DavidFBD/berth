import { NextResponse } from "next/server";
import { STAFF_OTHER_METHODS, staffRoute } from "@/lib/server/staff-gate";
import { markFeedback } from "@/lib/server/feedback";

export const dynamic = "force-dynamic";

/**
 * POST /api/staff/feedback { id, action: "read" | "fixed", note? }: mark a
 * message from the feedback sheet (lib/server/feedback markFeedback),
 * audited in the same statement. An admin with a fresh proof only; a
 * viewer gets 403, anyone else 404.
 */
export const POST = staffRoute(
  async (staff, request) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const result = await markFeedback(staff, { id: body.id, action: body.action, note: body.note });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.error === "not_found" ? 404 : 400 });
    return NextResponse.json(result);
  },
  { role: "admin", fresh: true },
);

export const { GET, PUT, PATCH, DELETE, HEAD, OPTIONS } = STAFF_OTHER_METHODS;
