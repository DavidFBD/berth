import { NextResponse } from "next/server";
import { getSql } from "@/lib/server/db";
import { auditCte, STAFF_OTHER_METHODS, staffRoute } from "@/lib/server/staff-gate";
import { cleanReason } from "@/lib/server/staff/actions";
import type { RevealField } from "@/lib/server/staff/users";
import { alertOnReveals, REVEALS_PER_HOUR, revealsLastHour } from "@/lib/server/staff/reveal-limit";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/staff/reveal { userId, identityId | column, reason }: one
 * masked field of one account, in full, once. An admin with a fresh proof
 * only; the audit row (who, whose, which field, why) is written before the
 * value is read, and a reveal that cannot be recorded does not happen. The
 * value is never logged. At most twenty an hour per staff member; at ten
 * the other admins are told (lib/server/staff/reveal-limit).
 */
export const POST = staffRoute(
  async (staff, request) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const reason = cleanReason(body.reason);
    const userId = typeof body.userId === "string" && UUID.test(body.userId) ? body.userId.toLowerCase() : null;
    let field: RevealField | null = null;
    if (typeof body.identityId === "string" && UUID.test(body.identityId)) field = { kind: "identity", identityId: body.identityId };
    else if (body.column === "email" || body.column === "wallet") field = { kind: "column", column: body.column };
    if (!reason || !userId || !field) return NextResponse.json({ error: "bad request" }, { status: 400 });
    const before = await revealsLastHour(staff.userId);
    if (before >= REVEALS_PER_HOUR) return NextResponse.json({ error: "too_many" }, { status: 429 });
    let kind: "email" | "wallet";
    if (field.kind === "identity") {
      const rows = (await getSql().query(`select kind from user_identities where id = $1 and user_id = $2`, [field.identityId, userId])) as { kind: "email" | "wallet" }[];
      if (!rows[0]) return NextResponse.json({ error: "not found" }, { status: 404 });
      kind = rows[0].kind;
    } else {
      kind = field.column;
    }
    // The audit row and the read are one statement: no value without its record.
    const params: unknown[] = [userId];
    const audit = auditCte(params, staff.userId, kind === "email" ? "reveal_email" : "reveal_wallet", `user:${userId}`, {
      reason,
      field: field.kind === "identity" ? `identity:${field.identityId}` : `column:${field.column}`,
    });
    let read: string;
    if (field.kind === "identity") {
      params.push(field.identityId);
      read = `select i.value from user_identities i, audit where i.id = $${params.length} and i.user_id = $1`;
    } else {
      read = `select ${field.column === "email" ? "u.email" : "u.wallet_address"} as value from users u, audit where u.id = $1`;
    }
    const rows = (await getSql().query(`with audit as (${audit}) ${read}`, params)) as { value: string | null }[];
    const raw = rows[0]?.value ?? null;
    const value = raw === null ? null : raw.replace(/^(?:eip155|solana|bip122):/, "");
    if (value !== null) await alertOnReveals(staff.userId, before + 1).catch(() => 0);
    if (value === null) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ value });
  },
  { role: "admin", fresh: true },
);

export const { GET, PUT, PATCH, DELETE, HEAD, OPTIONS } = STAFF_OTHER_METHODS;
