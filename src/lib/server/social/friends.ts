import { getSql } from "@/lib/server/db";
import { CODE_ALPHABET } from "@/lib/invite-code";
import { lookupKey } from "@/lib/handle";
import type { CardAnswer, FriendAction, FriendsList, Person } from "@/lib/social-types";
import { socialAudit } from "@/lib/server/social/audit";
import { sendNotice } from "@/lib/server/email/notify";
import { NOT_FOUND, readCardOf, relationTo, SIGN_IN } from "@/lib/server/social/cards";
import { anyTarget, hasVerifiedEmail, SHOWN_SQL, visibleTarget, type SocialViewer } from "@/lib/server/social/people";

/**
 * Friends: mutual, by request (docs/plans/social.md, "Crew is the
 * connection"; the UI says Friends). The state machine, from the viewer's
 * side:
 *
 *   none ──request──▶ sent ──cancel──▶ none
 *   received ──accept──▶ friends ──remove──▶ none
 *   received ──decline──▶ none   (silent: the sender still sees "sent")
 *
 * Asking someone who already asked you makes you friends. A new request to
 * someone who declined you within DECLINE_QUIET_DAYS is filed as declined at
 * once, so cancelling and asking again cannot knock twice. Both sides need a
 * username and the asker a verified email. Nobody but the viewer ever reads
 * the viewer's friends.
 */

export const FRIENDS_MAX = 50;
export const OUTGOING_MAX = 20;
export const DECLINE_QUIET_DAYS = 30;
/**
 * New requests an account may file in a day, whatever became of them:
 * declined, cancelled and silently filed ones count, so a cancel and ask
 * again loop runs out.
 */
export const DAILY_REQUEST_MAX = 20;

const pair = `least($1::uuid, $2::uuid), greatest($1::uuid, $2::uuid)`;

async function hasHandle(userId: string): Promise<boolean> {
  return ((await getSql().query(`select 1 from handles where user_id = $1`, [userId])) as unknown[]).length > 0;
}

async function friendCount(userId: string): Promise<number> {
  const rows = (await getSql().query(`select count(*)::int as n from friends where a_id = $1 or b_id = $1`, [userId])) as { n: number }[];
  return rows[0]?.n ?? 0;
}

/**
 * Makes the pair friends from `from`'s live request to `to`, if there is
 * one. The counts here are a quick no; the cap itself is the database's
 * (the friends_cap trigger in db/schema.sql), which holds under a race and
 * undoes the whole statement, the request's acceptance included.
 */
async function acceptFrom(from: string, to: string, statuses: string[]): Promise<boolean> {
  if ((await friendCount(from)) >= FRIENDS_MAX || (await friendCount(to)) >= FRIENDS_MAX) return false;
  let rows: { n: number }[];
  try {
    rows = await acceptStatement(from, to, statuses);
  } catch (error) {
    if (/friends cap reached/.test(error instanceof Error ? error.message : String(error))) return false;
    throw error;
  }
  return (rows[0]?.n ?? 0) > 0;
}

async function acceptStatement(from: string, to: string, statuses: string[]): Promise<{ n: number }[]> {
  return (await getSql().query(
    `with acc as (
       update friend_requests set status = 'accepted', responded_at = now()
       where from_id = $2 and to_id = $1 and status = any($3::text[])
       returning 1
     ),
     mirror as (
       update friend_requests set status = 'accepted', responded_at = now()
       where from_id = $1 and to_id = $2 and status in ('pending', 'declined') and exists (select 1 from acc)
     ),
     pair as (
       insert into friends (a_id, b_id) select ${pair} where exists (select 1 from acc)
       on conflict do nothing
     )
     select count(*)::int as n from acc`,
    [to, from, statuses],
  )) as { n: number }[];
}

/**
 * A referral that binds makes the pair friends at once, both ways, with no
 * request to accept (docs/plans/social.md, "Referral is friendship"). A
 * block either way stops it, so does the referrer's earlier decline of a
 * request from this account, and so does a full list on either side,
 * silently: the referral still stands, only the friendship is skipped. Any
 * live request between the two is settled as accepted. One audit row, on the
 * referred account, when a pair is made; a pair that already exists makes
 * none. Never throws: the referral must not fail over a friendship.
 */
export async function befriendOnReferral(
  referredId: string,
  referrerId: string,
  via: "invite" | "code" | "backfill",
): Promise<boolean> {
  if (referredId === referrerId) return false;
  try {
    if ((await friendCount(referredId)) >= FRIENDS_MAX || (await friendCount(referrerId)) >= FRIENDS_MAX) return false;
    const rows = (await getSql().query(
      `with walled as (
         select 1 from blocks
         where blocked_id is not null
           and ((blocker_id = $1 and blocked_id = $2) or (blocker_id = $2 and blocked_id = $1))
         union all
         -- The referrer once said no to a request from this account (a
         -- decline, or one cancelled after it was declined): that answer
         -- stands, the referral binds without the friendship.
         select 1 from friend_requests
         where from_id = $1 and to_id = $2
           and (status = 'declined' or (status = 'withdrawn' and responded_at is not null))
       ),
       made as (
         insert into friends (a_id, b_id) select ${pair} where not exists (select 1 from walled)
         on conflict do nothing
         returning 1
       ),
       settled as (
         update friend_requests set status = 'accepted', responded_at = now()
         where ((from_id = $1 and to_id = $2) or (from_id = $2 and to_id = $1))
           and status in ('pending', 'declined') and exists (select 1 from made)
       )
       select count(*)::int as n from made`,
      [referredId, referrerId],
    )) as { n: number }[];
    const made = (rows[0]?.n ?? 0) > 0;
    if (made) await socialAudit(referredId, "friend_referral", referrerId, { via });
    return made;
  } catch (error) {
    // The cap trigger lost a race, or anything else: the referral stands.
    console.warn("[social] referral friendship skipped:", error instanceof Error ? error.message : error);
    return false;
  }
}

async function request(viewer: SocialViewer, target: string, via: "handle" | "link"): Promise<boolean> {
  if (!hasVerifiedEmail(viewer) || target === viewer.id) return false;
  if (!(await hasHandle(viewer.id))) return false;
  const relation = await relationTo(viewer.id, target);
  if (relation === "friends" || relation === "sent") return false;
  // They asked first (or asked and were declined by you): this is yes.
  const theirs = (await getSql().query(
    `select 1 from friend_requests where from_id = $1 and to_id = $2 and status in ('pending', 'declined')`,
    [target, viewer.id],
  )) as unknown[];
  if (theirs.length > 0) {
    const made = await acceptFrom(target, viewer.id, ["pending", "declined"]);
    if (made) await socialAudit(viewer.id, "friend_accept", target, { via });
    return made;
  }
  const open = (await getSql().query(
    `select count(*)::int as n from friend_requests where from_id = $1 and status = 'pending'`,
    [viewer.id],
  )) as { n: number }[];
  if ((open[0]?.n ?? 0) >= OUTGOING_MAX) return false;
  if ((await friendCount(viewer.id)) >= FRIENDS_MAX) return false;
  const rows = (await getSql().query(
    `with quiet as (
       select exists (
         select 1 from friend_requests
         where from_id = $1 and to_id = $2 and responded_at > now() - make_interval(days => $4::int)
           and (status = 'declined' or (status = 'withdrawn' and responded_at is not null))
       ) as q
     )
     insert into friend_requests (from_id, to_id, via, status, responded_at)
     select $1, $2, $3, case when q then 'declined' else 'pending' end, case when q then now() end from quiet
     where (select count(*) from friend_requests where from_id = $1 and created_at > now() - interval '1 day') < $5
     on conflict do nothing
     returning id, status, (select handle from handles where user_id = $1) as handle`,
    [viewer.id, target, via, DECLINE_QUIET_DAYS, DAILY_REQUEST_MAX],
  )) as { id: string; status: string; handle: string | null }[];
  if (rows.length > 0) await socialAudit(viewer.id, "friend_request", target, { via });
  // A request that reaches them (not one held quiet after a decline) is a friends notice.
  if (rows[0]?.status === "pending" && rows[0].handle) {
    sendNotice({ userId: target, ref: rows[0].id, notice: { type: "friend_request", username: rows[0].handle } });
  }
  return rows.length > 0;
}

async function relationAct(viewer: SocialViewer, target: string, action: Exclude<FriendAction, "request">): Promise<boolean> {
  const sql = getSql();
  let rows: unknown[] = [];
  if (action === "accept") {
    const made = await acceptFrom(target, viewer.id, ["pending"]);
    if (made) await socialAudit(viewer.id, "friend_accept", target);
    return made;
  }
  if (action === "decline") {
    rows = (await sql.query(
      `update friend_requests set status = 'declined', responded_at = now()
       where from_id = $2 and to_id = $1 and status = 'pending' returning 1`,
      [viewer.id, target],
    )) as unknown[];
  } else if (action === "cancel") {
    // responded_at is left alone: set, it records that they had declined.
    rows = (await sql.query(
      `update friend_requests set status = 'withdrawn'
       where from_id = $1 and to_id = $2 and status in ('pending', 'declined') returning 1`,
      [viewer.id, target],
    )) as unknown[];
  } else {
    rows = (await sql.query(`delete from friends where a_id = least($1::uuid, $2::uuid) and b_id = greatest($1::uuid, $2::uuid) returning 1`, [
      viewer.id,
      target,
    ])) as unknown[];
  }
  if (rows.length > 0) await socialAudit(viewer.id, `friend_${action}` as const, target);
  return rows.length > 0;
}

export type FriendResult = { done: boolean; card: CardAnswer };

/**
 * One friend action on the person behind `handle` (or behind a friend link's
 * token, for a request). A request needs a card the viewer can see; the other
 * four act only on a relation the viewer already has, so they may reach a
 * card that is now hidden. Either way the answer carries the card as the
 * viewer may see it now, NOT_FOUND included.
 */
export async function friendAction(
  viewer: SocialViewer,
  action: FriendAction,
  target: { handle?: unknown; token?: unknown },
): Promise<FriendResult> {
  let targetId: string | null = null;
  let via: "handle" | "link" = "handle";
  if (action === "request" && target.token !== undefined) {
    // The link's owner, if their card is one the viewer may open.
    const owner = await linkOwner(target.token);
    if (owner && (await readCardOf(viewer, owner)).found) targetId = owner;
    via = "link";
  } else {
    const norm = lookupKey(target.handle);
    if (norm) targetId = action === "request" ? await visibleTarget(viewer.id, norm) : await anyTarget(norm);
  }
  if (!targetId) return { done: false, card: NOT_FOUND };
  const done = action === "request" ? await request(viewer, targetId, via) : await relationAct(viewer, targetId, action);
  return { done, card: await readCardOf(viewer, targetId) };
}

/**
 * People as the viewer's own lists show them. Someone whose card is off
 * shows only the name they had when it went off: no face, no XP, and not a
 * name they took after, since none of that is the viewer's to see now.
 */
const peopleSql = (ids: string) => `
  select shown, case when shown then h.handle else coalesce(p.hidden_handle, h.handle) end as handle,
    case when shown then u.avatar_id end as avatar_id, case when shown then u.xp else 0 end as xp
  from (
    select ids.id, ${SHOWN_SQL("ids.id")} as shown from (${ids}) ids(id)
  ) ids
  join handles h on h.user_id = ids.id join users u on u.id = ids.id
  left join profiles p on p.user_id = ids.id
  order by lower(case when shown then h.handle else coalesce(p.hidden_handle, h.handle) end)`;

type PersonRow = { handle: string; avatar_id: string | null; xp: number; shown: boolean };
const person = (row: PersonRow): Person =>
  row.shown ? { handle: row.handle, avatarId: row.avatar_id, xp: row.xp } : { handle: row.handle, avatarId: null, xp: 0, hidden: true };

/** The viewer's own friends, and requests in and out. Only ever the viewer's. */
export async function listFriends(viewer: SocialViewer): Promise<FriendsList> {
  const sql = getSql();
  const [friends, incoming, outgoing] = await Promise.all([
    sql.query(peopleSql(`select case when a_id = $1 then b_id else a_id end from friends where a_id = $1 or b_id = $1`), [viewer.id]),
    sql.query(
      peopleSql(
        `select r.from_id from friend_requests r where r.to_id = $1 and r.status = 'pending'
         and not exists (select 1 from blocks b where b.blocker_id = $1 and b.blocked_id = r.from_id)`,
      ),
      [viewer.id],
    ),
    sql.query(peopleSql(`select to_id from friend_requests where from_id = $1 and status in ('pending', 'declined')`), [viewer.id]),
  ]);
  return {
    friends: (friends as PersonRow[]).map(person),
    incoming: (incoming as PersonRow[]).map(person),
    outgoing: (outgoing as PersonRow[]).map(person),
  };
}

/* — friend links — */

const LINK_LENGTH = 12;

function mintToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(LINK_LENGTH));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

export function isLinkToken(value: unknown): value is string {
  return typeof value === "string" && new RegExp(`^[${CODE_ALPHABET}]{${LINK_LENGTH}}$`).test(value);
}

/**
 * The viewer's live friend link, minted on first ask; `fresh` revokes the
 * old one first, so a link that went too far stops working. Only an account
 * with a username has one. Its own token, never the referral code.
 */
export async function friendLink(viewer: SocialViewer, fresh = false): Promise<string | null> {
  if (!(await hasHandle(viewer.id))) return null;
  const sql = getSql();
  if (fresh) {
    await sql.query(`update friend_links set revoked_at = now() where user_id = $1 and revoked_at is null`, [viewer.id]);
    await socialAudit(viewer.id, "link_new");
  } else {
    const live = (await sql.query(`select token from friend_links where user_id = $1 and revoked_at is null`, [viewer.id])) as { token: string }[];
    if (live[0]) return live[0].token;
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const rows = (await sql.query(
        `insert into friend_links (token, user_id) values ($1, $2) on conflict do nothing returning token`,
        [mintToken(), viewer.id],
      )) as { token: string }[];
      if (rows[0]) return rows[0].token;
      const live = (await sql.query(`select token from friend_links where user_id = $1 and revoked_at is null`, [viewer.id])) as { token: string }[];
      if (live[0]) return live[0].token;
    } catch {
      // A second live link raced this one in; read it next round.
    }
  }
  return null;
}

/** The owner of a live link. Whether their card may be seen is the card's rule, not the link's. */
async function linkOwner(token: unknown): Promise<string | null> {
  if (!isLinkToken(token)) return null;
  const rows = (await getSql().query(`select user_id from friend_links where token = $1 and revoked_at is null`, [token])) as {
    user_id: string;
  }[];
  return rows[0]?.user_id ?? null;
}

/** The card a friend link opens, as the viewer may see it: NOT_FOUND for a dead link, a hidden card or a block. */
export async function readLinkCard(viewer: SocialViewer | null, token: unknown): Promise<CardAnswer> {
  if (!viewer) return SIGN_IN;
  const owner = await linkOwner(token);
  return owner ? readCardOf(viewer, owner) : NOT_FOUND;
}
