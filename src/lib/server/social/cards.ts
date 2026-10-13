import { getSql } from "@/lib/server/db";
import { lookupKey } from "@/lib/handle";
import type { Card, CardAnswer, Relation } from "@/lib/social-types";
import { hasVerifiedEmail, VISIBLE_SQL, type SocialViewer } from "@/lib/server/social/people";
import { friendHolds, SHARES_HOLDINGS_SQL } from "@/lib/server/social-proof";
import { profileMore } from "@/lib/server/social/profile-more";
import { activeFounderId } from "@/lib/server/social/founder";

/** `more`: the profile page's own read, which adds lib/server/social/profile-more. */
export type CardOptions = { more?: boolean };

/**
 * The card: face, username, XP (the rank is derived from it), the month the
 * account opened and the Salutes count, and where the viewer stands. Nothing
 * else leaves this module: no money, no wallet, no email, no friends and no
 * friend count. The one exception is between friends who both share what
 * they hold: then the card lists which board listings the other holds,
 * never how much (lib/server/social-proof). Every way a card can be missing (no such name, hidden,
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

async function answer(viewer: SocialViewer, row: CardRow | null, now: Date, options: CardOptions = {}): Promise<CardAnswer> {
  if (!row) return NOT_FOUND;
  const created = new Date(row.created_at);
  const card: Card = {
    handle: row.handle,
    avatarId: row.avatar_id,
    xp: row.xp,
    memberSince: `${created.getUTCFullYear()}-${String(created.getUTCMonth() + 1).padStart(2, "0")}`,
    salutes: row.salutes,
  };
  const [relation, saluted, hasHandle, sharing, founder] = await Promise.all([
    relationTo(viewer.id, row.user_id),
    viewer.id === row.user_id
      ? Promise.resolve(false)
      : getSql()
          .query(`select 1 from salutes where giver_id = $1 and recipient_id = $2 and revoked_at is null`, [viewer.id, row.user_id])
          .then((rows) => (rows as unknown[]).length > 0),
    getSql()
      .query(`select 1 from handles where user_id = $1`, [viewer.id])
      .then((rows) => (rows as unknown[]).length > 0),
    // The switch alone (said beside Add friend), and the full rule friendHolds asks (the switch and a shown card), read once.
    getSql()
      .query(
        `select coalesce((select share_holdings from profiles where user_id = $1::uuid), false) as switch_on, ${SHARES_HOLDINGS_SQL("$1::uuid")} as shares`,
        [viewer.id],
      )
      .then((rows) => (rows as { switch_on: boolean; shares: boolean }[])[0] ?? { switch_on: false, shares: false }),
    activeFounderId(),
  ]);
  // The founder's card says, to anyone else, that his holdings are not advice.
  if (founder !== null && row.user_id === founder && viewer.id !== founder) card.founder = true;
  const sharesHoldings = sharing.switch_on === true;
  const holdsRead = relation === "friends" && sharing.shares ? friendHolds(viewer, row.user_id, now, true) : Promise.resolve(null);
  const [holds, more] = await Promise.all([
    holdsRead,
    options.more
      ? profileMore({ viewer, targetId: row.user_id, relation, targetXp: card.xp, memberSince: card.memberSince, holds: holdsRead, viewerShares: sharing.shares === true, now })
      : Promise.resolve(null),
  ]);
  return {
    found: true,
    card,
    viewer: { relation, saluted, hasEmail: hasVerifiedEmail(viewer), hasHandle, ...(sharesHoldings ? { sharesHoldings: true } : {}) },
    ...(holds && holds.length > 0 ? { holds } : {}),
    ...(more ? { more } : {}),
  };
}

/**
 * The card behind a username as typed or as it sits in a URL. `now` dates
 * the friend's holdings read (a daily value must be recent); tests pin it.
 */
export async function readCard(viewer: SocialViewer | null, handle: unknown, now = new Date(), options: CardOptions = {}): Promise<CardAnswer> {
  if (!viewer) return SIGN_IN;
  const norm = lookupKey(handle);
  if (!norm) return NOT_FOUND;
  return answer(viewer, await cardRow(viewer.id, "h.handle_norm = $1", norm), now, options);
}

/** The card of a known account, by the same visibility rule. */
export async function readCardOf(viewer: SocialViewer | null, userId: string, now = new Date(), options: CardOptions = {}): Promise<CardAnswer> {
  if (!viewer) return SIGN_IN;
  return answer(viewer, await cardRow(viewer.id, "h.user_id = $1::uuid", userId), now, options);
}
