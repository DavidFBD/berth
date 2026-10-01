import { getSql } from "@/lib/server/db";
import { STAFF_SESSION_TTL_S } from "@/lib/server/staff-session";

/**
 * The staff sessions' rows (staff_sessions). A session lasts as long as the
 * Privy token it came from; a newer token for the same account renews it,
 * never past `max_until` (twelve hours from sign in). So a Privy session
 * that can no longer refresh, or a Berth sign out (which revokes it),
 * ends the staff session within the hour at most, and "Sign out
 * everywhere" ends every one of a staff member's sessions at once,
 * without a deploy.
 */

export type LiveSession = { id: string; userId: string; authAt: number | null; expiresAt: number };

const ms = (value: string | Date | null) => (value === null ? null : new Date(value).getTime());

export async function createStaffSession(userId: string, authAt: number | null, tokenExpiresAt: number, now = Date.now()): Promise<LiveSession> {
  const maxUntil = now + STAFF_SESSION_TTL_S * 1000;
  const expiresAt = Math.min(tokenExpiresAt, maxUntil);
  const rows = (await getSql().query(
    `insert into staff_sessions (staff_user_id, auth_at, created_at, expires_at, max_until)
     values ($1, $2, $3, $4, $5) returning id`,
    [userId, authAt === null ? null : new Date(authAt).toISOString(), new Date(now).toISOString(), new Date(expiresAt).toISOString(), new Date(maxUntil).toISOString()],
  )) as { id: string }[];
  return { id: rows[0].id, userId, authAt, expiresAt };
}

/**
 * Renews a live session from a newer token for the same account: a later
 * end (never past max_until) and the latest email proof. Null when the
 * session is gone, revoked, expired or someone else's.
 */
export async function renewStaffSession(id: string, userId: string, authAt: number | null, tokenExpiresAt: number, now = Date.now()): Promise<LiveSession | null> {
  const rows = (await getSql().query(
    `update staff_sessions
        set expires_at = least(greatest(expires_at, $3::timestamptz), max_until),
            auth_at = case when $4::timestamptz is null then auth_at else greatest(coalesce(auth_at, $4::timestamptz), $4::timestamptz) end
      where id = $1 and staff_user_id = $2 and revoked_at is null and expires_at > $5::timestamptz
      returning id, staff_user_id, auth_at, expires_at`,
    [id, userId, new Date(tokenExpiresAt).toISOString(), authAt === null ? null : new Date(authAt).toISOString(), new Date(now).toISOString()],
  )) as { id: string; staff_user_id: string; auth_at: string | null; expires_at: string }[];
  const row = rows[0];
  return row ? { id: row.id, userId: row.staff_user_id, authAt: ms(row.auth_at), expiresAt: ms(row.expires_at)! } : null;
}

/** The live session with this id, for a live account (not merged away), or null. */
export async function readLiveSession(id: string, now = Date.now()): Promise<LiveSession | null> {
  const rows = (await getSql().query(
    `select s.id, s.staff_user_id, s.auth_at, s.expires_at
       from staff_sessions s join users u on u.id = s.staff_user_id
      where s.id = $1 and s.revoked_at is null and s.expires_at > $2::timestamptz and u.retired_into is null`,
    [id, new Date(now).toISOString()],
  )) as { id: string; staff_user_id: string; auth_at: string | null; expires_at: string }[];
  const row = rows[0];
  return row ? { id: row.id, userId: row.staff_user_id, authAt: ms(row.auth_at), expiresAt: ms(row.expires_at)! } : null;
}

export async function revokeStaffSession(id: string): Promise<boolean> {
  const rows = (await getSql().query(`update staff_sessions set revoked_at = now() where id = $1 and revoked_at is null returning id`, [id])) as unknown[];
  return rows.length > 0;
}

/** "Sign out everywhere": every live session of this staff member. */
export async function revokeAllStaffSessions(userId: string): Promise<number> {
  const rows = (await getSql().query(`update staff_sessions set revoked_at = now() where staff_user_id = $1 and revoked_at is null returning id`, [userId])) as unknown[];
  return rows.length;
}
