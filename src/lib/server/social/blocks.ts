import { getSql } from "@/lib/server/db";
import { lookupKey, parseHandle } from "@/lib/handle";
import { REPORT_REASONS, type BlockedName, type ReportReason } from "@/lib/social-types";
import { socialAudit } from "@/lib/server/social/audit";
import { anyTarget, type SocialViewer } from "@/lib/server/social/people";

/**
 * Blocks and reports. A block is silent and total: in one statement the
 * pair stop being friends, every live request between them is withdrawn and
 * every Salute either way is revoked; from then on each answers "No one by
 * that name" to the other (VISIBLE_SQL). The blocked person is never told.
 * Unblocking lifts the wall and restores nothing.
 *
 * Both answer the same whether or not the name exists, and a block of a
 * name nobody holds is stored like any other, so neither the answer nor the
 * blocked list is an oracle.
 */
export async function setBlock(viewer: SocialViewer, handle: unknown, on: boolean): Promise<void> {
  const parsed = parseHandle(handle);
  if (!parsed.ok) return;
  const sql = getSql();
  if (!on) {
    const rows = (await sql.query(
      `delete from blocks where blocker_id = $1 and handle_norm = $2 returning blocked_id`,
      [viewer.id, parsed.norm],
    )) as { blocked_id: string | null }[];
    if (rows.length > 0) await socialAudit(viewer.id, "unblock", rows[0].blocked_id);
    return;
  }
  const target = await anyTarget(parsed.norm);
  if (target === viewer.id) return;
  // The row is written whether or not the name is anyone's: the list must
  // read the same for a hidden card and for no card at all.
  const rows = (await sql.query(
    `with b as (
       insert into blocks (blocker_id, blocked_id, handle_snapshot, handle_norm) values ($1, $2::uuid, $3, $4)
       on conflict do nothing returning 1
     ),
     f as (
       delete from friends where $2::uuid is not null and a_id = least($1::uuid, $2::uuid) and b_id = greatest($1::uuid, $2::uuid)
     ),
     r as (
       update friend_requests set status = 'withdrawn'
       where ((from_id = $1 and to_id = $2::uuid) or (from_id = $2::uuid and to_id = $1)) and status in ('pending', 'declined')
     ),
     s as (
       update salutes set revoked_at = now()
       where ((giver_id = $1 and recipient_id = $2::uuid) or (giver_id = $2::uuid and recipient_id = $1)) and revoked_at is null
     )
     select count(*)::int as n from b`,
    [viewer.id, target, parsed.handle, parsed.norm],
  )) as { n: number }[];
  if ((rows[0]?.n ?? 0) > 0) await socialAudit(viewer.id, "block", target, { handle: parsed.handle });
}

/**
 * The names the viewer has blocked, exactly as they typed them. Never the
 * face, the XP or the name the person goes by now: any of those would say
 * the name belongs to someone, and a hidden card would stop being hidden.
 */
export async function listBlocked(viewer: SocialViewer): Promise<BlockedName[]> {
  const rows = (await getSql().query(
    `select handle_snapshot from blocks where blocker_id = $1 order by created_at desc, id desc`,
    [viewer.id],
  )) as { handle_snapshot: string }[];
  return rows.map((row) => ({ handle: row.handle_snapshot }));
}

export function isReportReason(value: unknown): value is ReportReason {
  return typeof value === "string" && (REPORT_REASONS as readonly string[]).includes(value);
}

/** A report of a card: a reason from the fixed list and the name at the time. One open report per pair. */
export async function report(viewer: SocialViewer, handle: unknown, reason: ReportReason): Promise<void> {
  const norm = lookupKey(handle);
  const target = norm ? await anyTarget(norm) : null;
  if (!target || target === viewer.id) return;
  const rows = (await getSql().query(
    `insert into social_reports (reporter_id, target_id, handle_snapshot, reason)
     select $1, $2, h.handle, $3 from handles h
     where h.user_id = $2
       and not exists (select 1 from social_reports r where r.reporter_id = $1 and r.target_id = $2 and r.status = 'open')
     returning 1`,
    [viewer.id, target, reason],
  )) as unknown[];
  if (rows.length > 0) await socialAudit(viewer.id, "report", target, { reason });
}
