import { getSql } from "@/lib/server/db";
import { FIRST_FRIEND_NOTICE_ID } from "@/lib/social-proof";
import type { FirstFriendAnswer } from "@/lib/social-types";
import { hasVerifiedEmail, VISIBLE_SQL, type SocialViewer } from "@/lib/server/social/people";

/**
 * The founder as a ready-made first friend (docs/plans/2026-10-13-first-friend-nudge.md).
 * One account, named only by the env var BERTH_FOUNDER_USER_ID; unset (or
 * not a uuid), the whole feature is off. His profile must also carry
 * `friends_uncapped`, set by hand: if the env id and the flag disagree,
 * the feature is off too (fail closed).
 *
 * What it changes, and nothing more: a request to him makes friends at once
 * (lib/server/social/friends befriendFounder), the 50 cap skips his side,
 * he is left off every other person's friends board, he does not close
 * anyone's first path invite step, and his card and his lines in "Your
 * friends hold" say his holdings are for comparison, not advice. He pays
 * nothing: the path never touches `referred_by`, so no invite XP and no
 * campaign credit can follow from adding him.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The founder's account id from the environment, or null: the feature is off. */
export function founderId(env: Record<string, string | undefined> = process.env): string | null {
  const raw = env.BERTH_FOUNDER_USER_ID?.trim().toLowerCase();
  return raw && UUID.test(raw) ? raw : null;
}

/** Whether `userId` is the founder named by the environment. */
export function isFounder(userId: string | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  const id = founderId(env);
  return id !== null && typeof userId === "string" && userId.toLowerCase() === id;
}

/**
 * The founder's id when the feature is live: named by the environment and
 * his profile carries `friends_uncapped`. Null otherwise, everywhere.
 */
export async function activeFounderId(env: Record<string, string | undefined> = process.env): Promise<string | null> {
  const id = founderId(env);
  if (!id) return null;
  const rows = (await getSql().query(`select 1 from profiles where user_id = $1::uuid and friends_uncapped`, [id])) as unknown[];
  return rows.length > 0 ? id : null;
}

/** What the offer rule reads about the viewer and the founder. */
export type FirstFriendFacts = {
  /** The founder is live (activeFounderId). */
  founderLive: boolean;
  /** The viewer is the founder. */
  self: boolean;
  hasEmail: boolean;
  hasHandle: boolean;
  friends: number;
  /** Live requests the viewer sent (pending, or declined and still showing as sent). */
  outgoing: number;
  /** The founder's card is one this viewer may see, and he never said no to them. */
  founderVisible: boolean;
  /** "Not now" was tapped, or the viewer has had a friend: closed for good. */
  closed: boolean;
};

/**
 * Whether to offer the founder as a first friend. Any account with no
 * friends, whatever its age or its first path, until it dismisses the offer
 * or makes any friend. Deterministic: never a model call.
 */
export function offersFirstFriend(facts: FirstFriendFacts): boolean {
  return (
    facts.founderLive &&
    !facts.self &&
    facts.hasEmail &&
    facts.hasHandle &&
    facts.friends === 0 &&
    facts.outgoing === 0 &&
    facts.founderVisible &&
    !facts.closed
  );
}

const NONE: FirstFriendAnswer = { offer: null };

/** The offer for this viewer: the founder's card as they may see it, or null. */
export async function firstFriendOffer(viewer: SocialViewer, env: Record<string, string | undefined> = process.env): Promise<FirstFriendAnswer> {
  const founder = await activeFounderId(env);
  if (!founder || founder === viewer.id || !hasVerifiedEmail(viewer)) return NONE;
  const sql = getSql();
  const [mine, theirs] = await Promise.all([
    sql.query(
      `select exists (select 1 from handles where user_id = $1::uuid) as has_handle,
         (select count(*)::int from friends where a_id = $1::uuid or b_id = $1::uuid) as friends,
         (select count(*)::int from friend_requests where from_id = $1::uuid and status in ('pending', 'declined')) as outgoing,
         exists (select 1 from account_notices where user_id = $1::uuid and notice = $2) as closed`,
      [viewer.id, FIRST_FRIEND_NOTICE_ID],
    ),
    sql.query(
      `select h.handle, u.avatar_id, u.xp
       from handles h join users u on u.id = h.user_id
       left join profiles p on p.user_id = h.user_id
       where h.user_id = $2::uuid and u.retired_into is null and p.staff_hidden_at is null
         and ${VISIBLE_SQL("h", "$1::uuid")}
         and not exists (
           select 1 from friend_requests r
           where r.from_id = $1::uuid and r.to_id = $2::uuid
             and (r.status = 'declined' or (r.status = 'withdrawn' and r.responded_at is not null))
         )`,
      [viewer.id, founder],
    ),
  ]);
  const row = (mine as { has_handle: boolean; friends: number; outgoing: number; closed: boolean }[])[0];
  const card = (theirs as { handle: string; avatar_id: string | null; xp: number | string }[])[0];
  const offer = offersFirstFriend({
    founderLive: true,
    self: false,
    hasEmail: true,
    hasHandle: row?.has_handle === true,
    friends: row?.friends ?? 0,
    outgoing: row?.outgoing ?? 0,
    founderVisible: card !== undefined,
    closed: row?.closed === true,
  });
  if (!offer || !card) return NONE;
  return { offer: { handle: card.handle, avatarId: card.avatar_id ?? null, xp: Number(card.xp) || 0 } };
}

/**
 * Closes the first friend offer for good for each account: a friend was
 * made, so removing friends later never brings it back. Never throws: a
 * friendship must not fail over its notice.
 */
export async function closeFirstFriend(userIds: readonly string[]): Promise<void> {
  if (userIds.length === 0) return;
  try {
    await getSql().query(
      `insert into account_notices (user_id, notice) select unnest($1::uuid[]), $2 on conflict (user_id, notice) do nothing`,
      [userIds, FIRST_FRIEND_NOTICE_ID],
    );
  } catch (error) {
    console.warn("[social] first friend close failed:", error instanceof Error ? error.message : error);
  }
}
