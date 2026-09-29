import { getSql } from "@/lib/server/db";
import { lookupKey } from "@/lib/handle";
import type { CardAnswer, Relation } from "@/lib/social-types";
import { hasVerifiedEmail, VISIBLE_SQL, type SocialViewer } from "@/lib/server/social/people";

/**
 * The card: face, username, XP (the rank is derived from it), the month the
 * account opened and the Salutes count, and where the viewer stands. Nothing
 * else leaves this module: no money, no wallet, no email, no friends and no
 * friend count. Every way a card can be missing (no such name, hidden,
 * blocked, blocking, a malformed name) answers the same NOT_FOUND object.
 */

export const NOT_FOUND: CardAnswer = Object.freeze({ found: false }) as CardAnswer;

/** The one answer a signed out visitor gets, for any name at all. */
export const SIGN_IN: CardAnswer = Object.freeze({ found: false, signIn: true }) as CardAnswer;

type CardRow = {
  user_id: string;
  handle: string;
  avatar_id: string | null;
  xp: number;
  created_at: string;
  salutes: number;
};

async function cardRow(viewerId: string | null, where: string, param: string): Promise<CardRow | null> {
  const rows = (await getSql().query(
    `select h.user_id, h.handle, u.avatar_id, u.xp, u.created_at,
       (select count(*) from salutes s where s.recipient_id = h.user_id and s.revoked_at is null)::int as salutes
     from handles h join users u on u.id = h.user_id
     where ${where} and ${VISIBLE_SQL("h", "$2::uuid")}`,
    [param, viewerId],
  )) as CardRow[];
  return rows[0] ?? null;
}

/** Where `viewerId` stands with `targetId`, from the viewer's side only. */
export async function relationTo(viewerId: string, targetId: string): Promise<Relation> {
  if (viewerId === targetId) return "self";
  const rows = (await getSql().query(
    `select
       exists (select 1 from friends where a_id = least($1::uuid, $2::uuid) and b_id = greatest($1::uuid, $2::uuid)) as friends,
       exists (select 1 from friend_requests where from_id = $2 and to_id = $1 and status = 'pending') as received,
       exists (select 1 from friend_requests where from_id = $1 and to_id = $2 and status in ('pending', 'declined')) as sent`,
    [viewerId, targetId],
  )) as { friends: boolean; received: boolean; sent: boolean }[];
  const row = rows[0];
  // A decline is silent: the sender's request stays "sent". Two requests
  // crossing in flight read as received, so either side's tap makes friends.
  if (row?.friends) return "friends";
  if (row?.received) return "received";
  if (row?.sent) return "sent";
  return "none";
}

async function answer(viewer: SocialViewer, row: CardRow | null): Promise<CardAnswer> {
  if (!row) return NOT_FOUND;
  const created = new Date(row.created_at);
  const card = {
    handle: row.handle,
    avatarId: row.avatar_id,
    xp: row.xp,
    memberSince: `${created.getUTCFullYear()}-${String(created.getUTCMonth() + 1).padStart(2, "0")}`,
    salutes: row.salutes,
  };
  const [relation, saluted, hasHandle] = await Promise.all([
    relationTo(viewer.id, row.user_id),
    viewer.id === row.user_id
      ? Promise.resolve(false)
      : getSql()
          .query(`select 1 from salutes where giver_id = $1 and recipient_id = $2 and revoked_at is null`, [viewer.id, row.user_id])
          .then((rows) => (rows as unknown[]).length > 0),
    getSql()
      .query(`select 1 from handles where user_id = $1`, [viewer.id])
      .then((rows) => (rows as unknown[]).length > 0),
  ]);
  return { found: true, card, viewer: { relation, saluted, hasEmail: hasVerifiedEmail(viewer), hasHandle } };
}

/** The card behind a username as typed or as it sits in a URL. */
export async function readCard(viewer: SocialViewer | null, handle: unknown): Promise<CardAnswer> {
  if (!viewer) return SIGN_IN;
  const norm = lookupKey(handle);
  if (!norm) return NOT_FOUND;
  return answer(viewer, await cardRow(viewer.id, "h.handle_norm = $1", norm));
}

/** The card of a known account, by the same visibility rule. */
export async function readCardOf(viewer: SocialViewer | null, userId: string): Promise<CardAnswer> {
  if (!viewer) return SIGN_IN;
  return answer(viewer, await cardRow(viewer.id, "h.user_id = $1::uuid", userId));
}
