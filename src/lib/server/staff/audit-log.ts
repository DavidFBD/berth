import { getSql } from "@/lib/server/db";
import { scrubPersonal, scrubText } from "@/lib/staff/mask";

/** The staff Audit page: staff_audit, newest first, filterable, paginated. */

export type AuditFilters = { action?: string | null; staffId?: string | null; target?: string | null; page?: number; pageSize?: number };

export type AuditRow = { id: number; at: string; staffId: string | null; staffHandle: string | null; action: string; target: string | null; detail: Record<string, unknown> };

export const AUDIT_PAGE_SIZE = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listAudit(filters: AuditFilters = {}): Promise<{ rows: AuditRow[]; total: number; page: number; pages: number; actions: string[] }> {
  const pageSize = Math.min(Math.max(Math.floor(filters.pageSize ?? AUDIT_PAGE_SIZE), 1), 200);
  const page = Number.isFinite(filters.page) ? Math.min(Math.max(Math.floor(filters.page!), 1), 10_000) : 1;
  const params: unknown[] = [];
  const where: string[] = [];
  if (filters.action && /^[a-z0-9_]{2,64}$/.test(filters.action)) {
    params.push(filters.action);
    where.push(`a.action = $${params.length}`);
  }
  if (filters.staffId && UUID.test(filters.staffId)) {
    params.push(filters.staffId.toLowerCase());
    where.push(`a.staff_user_id = $${params.length}`);
  }
  if (filters.target && filters.target.trim()) {
    params.push(filters.target.trim().slice(0, 200));
    where.push(`a.target = $${params.length}`);
  }
  const clause = where.length ? `where ${where.join(" and ")}` : "";
  const sql = getSql();
  const [rows, counted, actions] = await Promise.all([
    sql.query(
      `select a.id, a.at, a.staff_user_id, h.handle, a.action, a.target, a.detail
         from staff_audit a left join handles h on h.user_id = a.staff_user_id
         ${clause} order by a.at desc, a.id desc limit ${pageSize} offset ${(page - 1) * pageSize}`,
      params,
    ),
    sql.query(`select count(*)::int as n from staff_audit a ${clause}`, params),
    sql.query(`select distinct action from staff_audit order by action`),
  ]);
  const total = Number((counted as { n: number }[])[0]?.n ?? 0);
  return {
    rows: (rows as { id: number; at: string; staff_user_id: string | null; handle: string | null; action: string; target: string | null; detail: Record<string, unknown> }[]).map((row) => ({
      id: Number(row.id),
      at: new Date(row.at).toISOString(),
      staffId: row.staff_user_id,
      staffHandle: row.handle,
      action: row.action,
      // Scrubbed again on the way out, for any row written before the writer scrubbed.
      detail: scrubPersonal(row.detail ?? {}),
      target: row.target ? scrubText(row.target) : null,
    })),
    total,
    page,
    pages: Math.ceil(total / pageSize),
    actions: (actions as { action: string }[]).map((row) => row.action),
  };
}
