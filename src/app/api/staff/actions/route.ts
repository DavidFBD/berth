import { NextResponse } from "next/server";
import { STAFF_OTHER_METHODS, staffRoute } from "@/lib/server/staff-gate";
import { isStaffAction, runStaffAction } from "@/lib/server/staff/actions";

export const dynamic = "force-dynamic";

/**
 * POST /api/staff/actions { action, reason, ... }: the staff area's safe
 * writes (lib/server/staff/actions), each audited with its reason. An
 * admin with a fresh proof only; a viewer gets 403, anyone else 404.
 */
export const POST = staffRoute(
  async (staff, request) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (!isStaffAction(body.action)) return NextResponse.json({ error: "bad request" }, { status: 400 });
    const result = await runStaffAction(staff, {
      action: body.action,
      reason: typeof body.reason === "string" ? body.reason : "",
      userId: typeof body.userId === "string" ? body.userId : null,
      grantId: typeof body.grantId === "string" ? body.grantId : null,
      sendId: typeof body.sendId === "string" ? body.sendId : null,
      service: typeof body.service === "string" ? body.service : null,
      balanceUsd: body.balanceUsd,
      threshold: body.threshold,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.error === "not_found" ? 404 : 400 });
    return NextResponse.json(result);
  },
  { role: "admin", fresh: true },
);

export const { GET, PUT, PATCH, DELETE, HEAD, OPTIONS } = STAFF_OTHER_METHODS;
