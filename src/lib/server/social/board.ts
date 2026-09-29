import { getSql } from "@/lib/server/db";
import type { BoardRow, FriendsBoard } from "@/lib/social-types";
import { SHOWN_SQL, type SocialViewer } from "@/lib/server/social/people";

/**
 * The friends board (ADR-0005): the viewer and their friends, ranked on
 * board points for this calendar month (UTC), never on money and never on
 * lifetime XP.
 *
 *   points = min(order XP this month, 300)
 *          + min(referral XP this month, 250)
 *          + other XP this month
 *          + min(Salutes first given this month and still standing, 10)
 *
 * Order XP is `pour_in` + `pour_out`, capped so the board cannot rank how
 * often someone trades. Referral XP is `friend_poured` + `invite_accepted`,
 * capped so the board cannot rank how many people someone signed up. A friend whose card is hidden drops off; the viewer
 * is always on it. Blocks already ended any friendship they touched.
 */

export const ORDER_XP_CAP = 300;
export const SALUTE_POINTS_CAP = 10;
export const REFERRAL_XP_CAP = 250;
export const ORDER_KINDS = ["pour_in", "pour_out"] as const;
export const REFERRAL_KINDS = ["friend_poured", "invite_accepted"] as const;

/** The calendar month `now` falls in, in UTC: [start, end) and its "2026-09" label. */
export function boardMonth(now: Date): { start: string; end: string; label: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const label = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`;
  return { start: start.toISOString(), end: end.toISOString(), label };
}

/** Board points from the month's parts, capped: the one statement of the sum. */
export function boardPoints(parts: { orderXp: number; referralXp: number; otherXp: number; salutes: number }): {
  orderXp: number;
  referralXp: number;
  otherXp: number;
  salutePoints: number;
  points: number;
} {
  const orderXp = Math.min(Math.max(parts.orderXp, 0), ORDER_XP_CAP);
  const referralXp = Math.min(Math.max(parts.referralXp, 0), REFERRAL_XP_CAP);
  const otherXp = Math.max(parts.otherXp, 0);
  const salutePoints = Math.min(Math.max(parts.salutes, 0), SALUTE_POINTS_CAP);
  return { orderXp, referralXp, otherXp, salutePoints, points: orderXp + referralXp + otherXp + salutePoints };
}

type Row = {
  id: string;
  handle: string | null;
  avatar_id: string | null;
  xp: number;
  order_xp: number;
  referral_xp: number;
  other_xp: number;
  salutes: number;
};

export async function friendsBoard(viewer: SocialViewer, now = new Date()): Promise<FriendsBoard> {
  const month = boardMonth(now);
  const rows = (await getSql().query(
    `with members as (
       select $1::uuid as id
       union
       select case when f.a_id = $1 then f.b_id else f.a_id end
       from friends f
       where (f.a_id = $1 or f.b_id = $1)
         and ${SHOWN_SQL("case when f.a_id = $1 then f.b_id else f.a_id end")}
     ),
     xp as (
       select e.user_id,
         coalesce(sum(e.amount) filter (where e.kind = any($4::text[])), 0)::int as order_xp,
         coalesce(sum(e.amount) filter (where e.kind = any($5::text[])), 0)::int as referral_xp,
         coalesce(sum(e.amount) filter (where not (e.kind = any($4::text[]) or e.kind = any($5::text[]))), 0)::int as other_xp
       from xp_events e
       where e.user_id in (select id from members) and e.created_at >= $2::timestamptz and e.created_at < $3::timestamptz
       group by e.user_id
     ),
     sal as (
       select s.recipient_id, count(*)::int as salutes
       from salutes s
       where s.recipient_id in (select id from members) and s.revoked_at is null
         and s.first_at >= $2::timestamptz and s.first_at < $3::timestamptz
       group by s.recipient_id
     )
     select m.id, h.handle, u.avatar_id, u.xp,
       coalesce(xp.order_xp, 0) as order_xp, coalesce(xp.referral_xp, 0) as referral_xp, coalesce(xp.other_xp, 0) as other_xp, coalesce(sal.salutes, 0) as salutes
     from members m
     join users u on u.id = m.id
     left join handles h on h.user_id = m.id
     left join xp on xp.user_id = m.id
     left join sal on sal.recipient_id = m.id`,
    [viewer.id, month.start, month.end, ORDER_KINDS, REFERRAL_KINDS],
  )) as Row[];
  const scored = rows
    .map((row) => ({
      row,
      ...boardPoints({ orderXp: row.order_xp, referralXp: row.referral_xp, otherXp: row.other_xp, salutes: row.salutes }),
    }))
    .sort((a, b) => b.points - a.points || (a.row.handle ?? "").localeCompare(b.row.handle ?? ""));
  let place = 0;
  let last: number | null = null;
  const board: BoardRow[] = scored.map((entry, index) => {
    // Equal points share a place: 1, 2, 2, 4.
    if (entry.points !== last) place = index + 1;
    last = entry.points;
    return {
      handle: entry.row.handle ?? "",
      avatarId: entry.row.avatar_id,
      xp: entry.row.xp,
      you: entry.row.id === viewer.id,
      place,
      points: entry.points,
      orderXp: entry.orderXp,
      referralXp: entry.referralXp,
      otherXp: entry.otherXp,
      salutePoints: entry.salutePoints,
    };
  });
  return { month: month.label, rows: board };
}
