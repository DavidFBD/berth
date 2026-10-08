import { getSql } from "@/lib/server/db";
import type { Face, Moment, ProfileMore, Relation } from "@/lib/social-types";
import { SHOWN_SQL, type SocialViewer } from "@/lib/server/social/people";
import { ownHolds } from "@/lib/server/social-proof";
import { RANKS, rankForXp } from "@/lib/xp";

/**
 * What the profile page (/u/<name>, /f/<token>) adds to a card, read only
 * for a card the viewer may already open (cards.ts calls it after the
 * visibility rule passed), so hidden, blocked and missing stay the one
 * NOT_FOUND with nothing beside it.
 *
 * The rule of what may be said: nothing the viewer could not already learn
 * from the card itself or from their own side. A stranger's card gets only
 * the viewer's own XP (for "You're 120 XP ahead"; the friend's XP is on the
 * card). Between friends, and on the viewer's own card, a short timeline
 * of moments: the day a rung was reached, between friends only from the
 * day they became friends (the card shows XP live, so a friend who looks
 * each day sees the same), the day they became friends,
 * the Salutes between the two, and the month they joined. Dates are days,
 * never times. Never an amount, a trade, a holding's size or an order,
 * and never anyone else's Salute.
 *
 * "In common", between friends only: the day they became friends, the
 * friends both have whose cards the viewer may open (SHOWN_SQL, no block
 * between the viewer and them), and which board listings both hold, only
 * while both share under the "Your friends hold" rule (friendHolds, passed
 * in as `holds`, against the viewer's own last daily value, as fresh).
 */

/** Faces shown in "In common"; the rest are a count. */
export const MUTUAL_FACES = 4;

/** The timeline's length, the month they joined included. */
export const MOMENTS_MAX = 5;

export type MoreInput = {
  viewer: SocialViewer;
  targetId: string;
  relation: Relation;
  /** The card's own XP and month, as it already shows them. */
  targetXp: number;
  memberSince: string;
  /** What the friend holds, the card's own read of it (friendHolds), in flight: null unless both share. */
  holds: Promise<string[] | null>;
  /** The viewer's SHARES_HOLDINGS_SQL, as the card already read it. */
  viewerShares: boolean;
  now: Date;
};

const day = (at: string | Date) => new Date(at).toISOString().slice(0, 10);

/** The day the account's running XP first reached each rung it holds now, above the first. */
async function rankDays(userId: string, xp: number): Promise<Moment[]> {
  const held = RANKS.filter((rank) => rank.level > 1 && rank.level <= rankForXp(xp).level);
  if (held.length === 0) return [];
  const rows = (await getSql().query(
    `with running as (
       select created_at, sum(amount) over (order by created_at, id rows between unbounded preceding and current row) as total
       from xp_events where user_id = $1
     )
     select r.level, min(running.created_at) as at
     from unnest($2::int[], $3::int[]) as r(level, xp)
     join running on running.total >= r.xp
     group by r.level`,
    [userId, held.map((rank) => rank.level), held.map((rank) => rank.xp)],
  )) as { level: number; at: string | Date }[];
  return rows.map((row) => ({ kind: "rank", level: Number(row.level), on: day(row.at) }));
}

/** The day the two became friends, and the Salutes standing between them. */
async function pairDays(viewerId: string, targetId: string): Promise<Moment[]> {
  const sql = getSql();
  const [friends, salutes] = await Promise.all([
    sql.query(`select since from friends where a_id = least($1::uuid, $2::uuid) and b_id = greatest($1::uuid, $2::uuid)`, [viewerId, targetId]),
    sql.query(
      `select giver_id::text as giver_id, first_at from salutes
       where ((giver_id = $1 and recipient_id = $2) or (giver_id = $2 and recipient_id = $1)) and revoked_at is null`,
      [viewerId, targetId],
    ),
  ]);
  const moments: Moment[] = (friends as { since: string | Date }[]).map((row) => ({ kind: "friends", on: day(row.since) }));
  for (const row of salutes as { giver_id: string; first_at: string | Date }[]) {
    moments.push({ kind: "salute", from: row.giver_id === viewerId ? "you" : "them", on: day(row.first_at) });
  }
  return moments;
}

/** Friends of both, as their own cards show them, that the viewer may open. */
async function mutualFriends(viewerId: string, targetId: string): Promise<{ faces: Face[]; more: number }> {
  const rows = (await getSql().query(
    `with mine as (
       select case when a_id = $1::uuid then b_id else a_id end as id from friends where a_id = $1::uuid or b_id = $1::uuid
     ),
     theirs as (
       select case when a_id = $2::uuid then b_id else a_id end as id from friends where a_id = $2::uuid or b_id = $2::uuid
     )
     select h.handle, u.avatar_id, u.xp
     from mine join theirs on theirs.id = mine.id
     join users u on u.id = mine.id and u.retired_into is null
     join handles h on h.user_id = mine.id
     where mine.id <> $1::uuid and mine.id <> $2::uuid
       and ${SHOWN_SQL("mine.id")}
       and not exists (
         select 1 from blocks b
         where (b.blocker_id = $1::uuid and b.blocked_id = mine.id) or (b.blocker_id = mine.id and b.blocked_id = $1::uuid)
       )
     order by lower(h.handle)`,
    [viewerId, targetId],
  )) as { handle: string; avatar_id: string | null; xp: number | string }[];
  const faces = rows.slice(0, MUTUAL_FACES).map((row) => ({
    handle: row.handle,
    avatarId: row.avatar_id ?? null,
    level: rankForXp(Number(row.xp) || 0).level,
  }));
  return { faces, more: Math.max(rows.length - MUTUAL_FACES, 0) };
}

/** Newest first, at most MOMENTS_MAX with the month they joined always the last. */
export function arrangeMoments(dated: Moment[], memberSince: string): Moment[] {
  const order = { rank: 0, friends: 1, salute: 2, joined: 3 } as const;
  const newest = dated
    .filter((moment): moment is Exclude<Moment, { kind: "joined" }> => moment.kind !== "joined")
    .sort((a, b) => b.on.localeCompare(a.on) || order[a.kind] - order[b.kind])
    .slice(0, MOMENTS_MAX - 1);
  return [...newest, { kind: "joined", month: memberSince }];
}

export async function profileMore({ viewer, targetId, relation, targetXp, memberSince, holds, viewerShares, now }: MoreInput): Promise<ProfileMore> {
  const more: ProfileMore = {};
  const self = relation === "self";
  // Every read below goes out at once: one round trip, whatever the relation.
  const yourXp = self
    ? Promise.resolve(undefined)
    : getSql()
        .query(`select xp from users where id = $1`, [viewer.id])
        .then((rows) => Number((rows as { xp: number }[])[0]?.xp ?? 0));
  if (self) {
    more.moments = arrangeMoments(await rankDays(targetId, targetXp), memberSince);
    return more;
  }
  if (relation !== "friends") {
    more.yourXp = await yourXp;
    return more;
  }
  const [xp, ranks, pair, mutual, theirs, mine] = await Promise.all([
    yourXp,
    rankDays(targetId, targetXp),
    pairDays(viewer.id, targetId),
    mutualFriends(viewer.id, targetId),
    holds,
    viewerShares ? ownHolds(viewer, now, true) : Promise.resolve(null),
  ]);
  more.yourXp = xp;
  const since = pair.find((moment) => moment.kind === "friends");
  if (since?.kind === "friends") more.friendsSince = since.on;
  // Only rungs reached since the two became friends: an earlier date would
  // say when they were active before the viewer knew them.
  const known = since?.kind === "friends" ? ranks.filter((moment) => moment.kind === "rank" && moment.on >= since.on) : [];
  more.moments = arrangeMoments([...known, ...pair], memberSince);
  more.salutesBetween = pair.filter((moment) => moment.kind === "salute").length;
  if (mutual.faces.length > 0) more.mutual = mutual;
  const both = theirs && mine ? theirs.filter((symbol) => mine.includes(symbol)) : [];
  if (both.length > 0) more.bothHold = both;
  return more;
}
