import { getSql } from "@/lib/server/db";
import { SHOWN_SQL, type SocialViewer } from "@/lib/server/social/people";
import { loadListingOrders, loadPortfolioDays } from "@/lib/server/portfolio";
import { readMarks } from "@/lib/server/marks";
import { lookupKey } from "@/lib/handle";
import { newYorkDay } from "@/lib/marks";
import { FRIEND_HOLDINGS_MAX_AGE_DAYS } from "@/lib/social-proof";
import { rankForXp } from "@/lib/xp";
import {
  friendWindow,
  returnSeries,
  windowAllowed,
  type CompareFriendsResponse,
  type FriendWeekResponse,
} from "@/lib/friend-week";

/**
 * "Compare with friends" (lib/friend-week), the server side: which friends
 * may be drawn beside the viewer, and one friend's line over the viewer's
 * window. Private and opt in on both sides, as "Your friends hold" is
 * (lib/server/social-proof), with the same checks: friends, both switches
 * on, both cards shown (a hidden profile or one without a verified email
 * is not), no block either way, the friend's account not retired, and a
 * daily value no older than FRIEND_HOLDINGS_MAX_AGE_DAYS. Answered only
 * through the social route (POST, no-store, rate limited), never from a
 * shared cache. Every refusal is the same empty answer, so it never says
 * which check failed.
 */

/**
 * Whether the account `userId` (an SQL expression) compares its week with
 * its friends: its card is shown and its own switch, "Let my friends
 * compare their week with mine", is on. Off by default. Asked of both
 * sides: each sees the others' only by sharing their own.
 */
export const SHARES_WEEK_SQL = (userId: string) => `
  (${SHOWN_SQL(userId)}
   and exists (select 1 from profiles sw where sw.user_id = ${userId} and sw.share_week))`;

/** The first day a daily value still counts as recent: FRIEND_HOLDINGS_MAX_AGE_DAYS back. */
function recentSince(now: Date): string {
  return new Date(now.getTime() - FRIEND_HOLDINGS_MAX_AGE_DAYS * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Whether the viewer may see friends' lines: their own switch and card, and
 * a daily value of their own as recent as a friend's must be. So nobody
 * reads a friend's line without one of their own beside it (review M2).
 */
async function viewerSharesWeek(viewerId: string, now: Date): Promise<boolean> {
  const rows = (await getSql().query(
    `select ${SHARES_WEEK_SQL("$1::uuid")}
       and exists (select 1 from portfolio_days vd where vd.user_id = $1::uuid and vd.day >= $2::date) as ok`,
    [viewerId, recentSince(now)],
  )) as { ok: boolean }[];
  return rows[0]?.ok === true;
}

type FriendRow = { user_id: string; handle: string; avatar_id: string | null; xp: number | string | null };

/** The viewer's friends who compare, with a fresh daily value. `norm` narrows it to one username. */
async function comparingFriends(viewerId: string, now: Date, norm?: string): Promise<FriendRow[]> {
  const since = recentSince(now);
  return (await getSql().query(
    `with mine as (
       select case when f.a_id = $1::uuid then f.b_id else f.a_id end as id
       from friends f
       where f.a_id = $1::uuid or f.b_id = $1::uuid
     )
     select m.id::text as user_id, h.handle, u.avatar_id, u.xp
     from mine m
     join users u on u.id = m.id and u.retired_into is null
     join handles h on h.user_id = m.id
     where ($3::text is null or h.handle_norm = $3::text)
       and ${SHARES_WEEK_SQL("m.id")}
       and exists (select 1 from portfolio_days pd where pd.user_id = m.id and pd.day >= $2::date)
       and not exists (
         select 1 from blocks b
         where (b.blocker_id = $1::uuid and b.blocked_id = m.id)
            or (b.blocker_id = m.id and b.blocked_id = $1::uuid)
       )
     order by h.handle_norm`,
    [viewerId, since, norm ?? null],
  )) as FriendRow[];
}

/** The friends the picker offers: username, avatar and rank level, as their card shows them. */
export async function compareFriends(viewer: SocialViewer, now = new Date()): Promise<CompareFriendsResponse> {
  if (!(await viewerSharesWeek(viewer.id, now))) return { friends: [] };
  const rows = await comparingFriends(viewer.id, now);
  return {
    friends: rows.map((row) => ({
      handle: row.handle,
      avatarId: row.avatar_id ?? null,
      // XP is read only to find the level and goes no further.
      level: rankForXp(Number(row.xp) || 0).level,
    })),
  };
}

const NONE: FriendWeekResponse = { week: null };

/**
 * One friend's return, percent only, over the viewer's window: `range` the
 * card's ("1w" or "since") and `from` its first day (lib/friend-week
 * windowAllowed bounds it by the viewer's own record). The line starts on
 * the friend's first close on or after `from`, so since first buy is the
 * overlap from the later of the two first buys.
 */
export async function friendWeek(
  viewer: SocialViewer,
  body: { handle?: unknown; range?: unknown; from?: unknown },
  now = new Date(),
): Promise<FriendWeekResponse> {
  const norm = lookupKey(body.handle);
  if (!norm) return NONE;
  if (!(await viewerSharesWeek(viewer.id, now))) return NONE;
  const today = newYorkDay(now);
  // The viewer's own first valued day bounds since first buy: never longer than their own line.
  const ownFirstDay =
    body.range === "since"
      ? ((await loadPortfolioDays(viewer.id)).find((day) => day.value > 0)?.day ?? null)
      : null;
  if (!windowAllowed(body.range, body.from, { today, ownFirstDay })) return NONE;
  const from = body.from as string;
  const friend = (await comparingFriends(viewer.id, now, norm))[0];
  if (!friend || friend.user_id === viewer.id) return NONE;

  const [days, orders] = await Promise.all([loadPortfolioDays(friend.user_id), loadListingOrders(friend.user_id)]);
  const symbols = [
    ...new Set([...orders.map((order) => order.symbol), ...days.flatMap((day) => day.holdings.map((holding) => holding.symbol))]),
  ];
  const listingCloses = symbols.length > 0 ? await readMarks(symbols) : {};
  // Only the percentages leave: the days, orders and closes stop here.
  return { week: friendWindow(returnSeries({ days, orders, listingCloses }), from) };
}
