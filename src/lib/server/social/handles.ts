import { getSql } from "@/lib/server/db";
import {
  HANDLE_CHANGE_DAYS,
  HANDLE_RETIRE_DAYS,
  parseHandle,
  refusedName,
  type HandleRefusal,
} from "@/lib/handle";
import type { HandleCheck, MySocial } from "@/lib/social-types";
import type { RewardList } from "@/lib/profile-types";
import { awardXp, flushUnannounced } from "@/lib/server/accounts";
import { XP_ACTIONS } from "@/lib/xp";
import { sameFriendFeatures } from "@/lib/friends-all";
import { socialAudit } from "@/lib/server/social/audit";
import { markNoticeSeen } from "@/lib/server/notices";
import { SOCIAL_NOTICE_ID } from "@/lib/social-proof";
import { hasVerifiedEmail, ownHandle, type SocialViewer } from "@/lib/server/social/people";

/**
 * Picking, changing and hiding a username. The rulebook (lib/handle) decides
 * what a name is; this module decides whether this account may have this one
 * now: a verified email, a name nobody else holds or has just dropped, and
 * one change per 30 days, any change at all (saving the same name again is
 * not a change).
 */

const DAY_MS = 86_400_000;

/** A verified email on the house's domain. */
export function isStaff(viewer: SocialViewer): boolean {
  return viewer.email !== null && viewer.email.trim().toLowerCase().endsWith("@sodax.com");
}

function nextChange(changedAt: string, now: Date): string | null {
  const next = new Date(new Date(changedAt).getTime() + HANDLE_CHANGE_DAYS * DAY_MS);
  return next > now ? next.toISOString() : null;
}

/**
 * Whether `value` could be this viewer's username. "taken" covers a name
 * someone holds, a name held after a change, and the house's reserved names
 * alike: the picker never says which, so it cannot tell a hidden card from a
 * reserved word.
 */
export async function checkHandle(viewer: SocialViewer, value: unknown, now = new Date()): Promise<HandleCheck> {
  if (!hasVerifiedEmail(viewer)) return { ok: false, reason: "noEmail" };
  const parsed = parseHandle(value);
  if (!parsed.ok) return parsed;
  const refused = refusedName(parsed);
  if (refused === "offensive") return { ok: false, reason: "offensive" };
  // The house's own people (a verified @sodax.com email) may carry house
  // words such as sodax or berth; everyone else gets the one answer.
  if (refused === "reserved" && !isStaff(viewer)) return { ok: false, reason: "taken" };
  const mine = await ownHandle(viewer.id);
  if (mine && mine.handle !== parsed.handle && nextChange(mine.changedAt, now)) return { ok: false, reason: "cooldown" };
  const rows = (await getSql().query(
    `select
       exists (select 1 from handles where handle_norm = $1 and user_id <> $2) as held,
       exists (
         select 1 from handle_reserved
         where handle_norm = $1 and (until is null or until > $3::timestamptz)
           and user_id is distinct from $2
       ) as reserved`,
    [parsed.norm, viewer.id, now.toISOString()],
  )) as { held: boolean; reserved: boolean }[];
  if (rows[0]?.held || rows[0]?.reserved) return { ok: false, reason: "taken" };
  return { ok: true, handle: parsed.handle };
}

/**
 * `rewards` is what this save paid (the first username's username_set, and
 * any parked news flushed with it), `xp` the fresh total when it paid;
 * a rename or a resave pays nothing and carries an empty list.
 */
export type SetHandleResult =
  | { ok: true; social: MySocial; rewards: RewardList; xp: number | null }
  | { ok: false; reason: HandleRefusal };

/**
 * Picks or changes the username, and with the first pick turns the card on.
 * One statement: the upsert only changes an existing name when the 30 days
 * have passed (saving the very same name changes nothing); the old fold is held 90 days for this
 * account; the profile row appears with the first name. A race for the same
 * name ends at the unique fold, and the loser hears "taken".
 *
 * The first name (the row inserted, not updated) pays username_set once per
 * person: a rename pays nothing, the once per account index settles two
 * first saves racing, and a merge keeps one award (merge_accounts leaves a
 * second once kind on the retired row). A house word only staff may carry
 * pays nothing.
 */
export async function setHandle(viewer: SocialViewer, value: unknown, now = new Date()): Promise<SetHandleResult> {
  const check = await checkHandle(viewer, value, now);
  if (!check.ok) return check;
  const parsed = parseHandle(check.handle);
  if (!parsed.ok) return parsed;
  const before = await ownHandle(viewer.id);
  let rows: { handle: string; inserted: boolean }[];
  try {
    rows = (await getSql().query(
      `with old as (select handle_norm from handles where user_id = $1),
       up as (
         insert into handles (user_id, handle, handle_norm, created_at, changed_at)
         values ($1, $2, $3, $4::timestamptz, $4::timestamptz)
         on conflict (user_id) do update
           set handle = excluded.handle,
               handle_norm = excluded.handle_norm,
               changed_at = case when handles.handle = excluded.handle then handles.changed_at else excluded.changed_at end
           where handles.handle = excluded.handle
              or handles.changed_at <= $4::timestamptz - make_interval(days => $5::int)
         returning handle, handle_norm, (xmax::text = '0') as inserted
       ),
       prof as (
         insert into profiles (user_id, visible, updated_at)
         select $1, true, $4::timestamptz from up
         on conflict (user_id) do nothing
       ),
       held as (
         insert into handle_reserved (handle_norm, reason, user_id, until)
         select old.handle_norm, 'retired', $1, $4::timestamptz + make_interval(days => $6::int)
         from old, up where old.handle_norm <> up.handle_norm
         on conflict (handle_norm) do update
           set reason = 'retired', user_id = excluded.user_id, until = excluded.until
           where handle_reserved.reason = 'retired'
       ),
       freed as (
         delete from handle_reserved r using up
         where r.handle_norm = up.handle_norm and r.reason = 'retired' and r.user_id = $1
       )
       select handle, inserted from up`,
      [viewer.id, parsed.handle, parsed.norm, now.toISOString(), HANDLE_CHANGE_DAYS, HANDLE_RETIRE_DAYS],
    )) as { handle: string; inserted: boolean }[];
  } catch (error) {
    if (/unique|duplicate/i.test(error instanceof Error ? error.message : String(error))) return { ok: false, reason: "taken" };
    throw error;
  }
  if (!rows[0]) return { ok: false, reason: "cooldown" };
  if (!before || before.norm !== parsed.norm || before.handle !== parsed.handle) {
    await socialAudit(viewer.id, before ? "handle_changed" : "handle_set", viewer.id, {
      handle: parsed.handle,
      ...(before ? { was: before.handle } : {}),
    });
  }
  let rewards: RewardList = [];
  let xp: number | null = null;
  if (rows[0].inserted && refusedName(parsed) !== "reserved") {
    const paid = await awardXp(viewer.id, "username_set", null);
    if (paid.awarded > 0) {
      rewards = [{ kind: "username_set", amount: paid.awarded }, ...(await flushUnannounced(viewer.id))];
      xp = paid.xp;
    }
  }
  return { ok: true, social: await mySocial(viewer, now), rewards, xp };
}

/** "Hide my card": one switch. Hidden reads exactly like missing, to everyone else. */
export async function setVisible(viewer: SocialViewer, visible: boolean, now = new Date()): Promise<MySocial | null> {
  const rows = (await getSql().query(
    `update profiles set visible = $2,
       hidden_at = case when $2 then null else $3::timestamptz end,
       hidden_handle = case when $2 then null else (select handle from handles where user_id = $1) end,
       updated_at = $3::timestamptz
     where user_id = $1 and visible is distinct from $2
       -- A card staff hid (moderation) stays hidden until staff show it.
       and not ($2 and staff_hidden_at is not null)
     returning visible`,
    [viewer.id, visible, now.toISOString()],
  )) as { visible: boolean }[];
  if (rows[0]) await socialAudit(viewer.id, visible ? "unhide" : "hide", viewer.id);
  const mine = await ownHandle(viewer.id);
  return mine ? mySocial(viewer, now) : null;
}

/**
 * "Show my avatar, username and rank on links I share": one switch, off by
 * default. It changes only the link previews of /u/<username> and of the
 * owner's invite link (lib/server/og-people); the profile itself is
 * governed by the hide switch.
 */
export async function setLinkFace(viewer: SocialViewer, on: boolean, now = new Date()): Promise<MySocial | null> {
  const rows = (await getSql().query(
    `update profiles set link_face = $2, updated_at = $3::timestamptz
     where user_id = $1 and link_face is distinct from $2
     returning link_face`,
    [viewer.id, on, now.toISOString()],
  )) as { link_face: boolean }[];
  if (rows[0]) await socialAudit(viewer.id, on ? "link_face_on" : "link_face_off", viewer.id);
  const mine = await ownHandle(viewer.id);
  return mine ? mySocial(viewer, now) : null;
}

/**
 * "Let my friends see which stocks and funds I hold": one switch, off by
 * default (B1 of reports/social-proof-review.md). It decides whether this
 * account is counted or named in its friends' lists of what they hold, and,
 * by the same switch, whether it sees theirs (lib/server/social-proof).
 */
export async function setShareHoldings(viewer: SocialViewer, on: boolean, now = new Date()): Promise<MySocial | null> {
  const rows = (await getSql().query(
    `update profiles set share_holdings = $2, updated_at = $3::timestamptz
     where user_id = $1 and share_holdings is distinct from $2
     returning share_holdings`,
    [viewer.id, on, now.toISOString()],
  )) as { share_holdings: boolean }[];
  if (rows[0]) await socialAudit(viewer.id, on ? "share_holdings_on" : "share_holdings_off", viewer.id);
  // The social notice points to this switch: someone who turned it on has found it.
  if (on) await closeSocialNotice(viewer.id);
  const mine = await ownHandle(viewer.id);
  return mine ? mySocial(viewer, now) : null;
}

/**
 * Closes the social notice ("See the switch") after its switch was turned
 * on. A side effect only: the toggle has already been saved, so a failure
 * here is logged and the toggle still answers as done. The notice also
 * stays quiet while holdings are shared (lib/social-proof dueNotices).
 */
async function closeSocialNotice(userId: string): Promise<void> {
  try {
    await markNoticeSeen(userId, SOCIAL_NOTICE_ID);
  } catch (error) {
    console.warn("[social] could not close the social notice after a toggle", error);
  }
}

/**
 * "Compare weeks with friends": one switch, off by
 * default. It decides whether a friend who turned it on too may draw this
 * account's return, percent only, beside their own on the account card,
 * and, by the same switch, whether this account may draw theirs
 * (lib/server/social/compare).
 */
export async function setShareWeek(viewer: SocialViewer, on: boolean, now = new Date()): Promise<MySocial | null> {
  const rows = (await getSql().query(
    `update profiles set share_week = $2, updated_at = $3::timestamptz
     where user_id = $1 and share_week is distinct from $2
     returning share_week`,
    [viewer.id, on, now.toISOString()],
  )) as { share_week: boolean }[];
  if (rows[0]) await socialAudit(viewer.id, on ? "share_week_on" : "share_week_off", viewer.id);
  const mine = await ownHandle(viewer.id);
  return mine ? mySocial(viewer, now) : null;
}

export type SetAllFriendsResult =
  | { ok: true; social: MySocial; rewards: RewardList; xp: number | null }
  | { ok: false; reason: "email" | "no username" | "features" };

/**
 * "Turn on all friend features": every friend sharing switch to its sharing
 * state in one statement (so one transaction): the profile shown, shown on
 * shared links, holdings shared, weeks compared. A card staff hid stays
 * hidden (staff_hidden_at is never overridden), and while it is, the one
 * time friends_all_on XP is not paid: the person has not ended with
 * everything on, and can claim it once staff show the card again.
 *
 * The XP is paid in the same statement, at most once per person, ever (the
 * once per account index on xp_events), and never depends on keeping the
 * features on: turning any of them off later takes nothing back, and
 * turning everything off and on again pays nothing more. Each switch that
 * moved writes its own audit line, and the combined act one more, which
 * records the features the person was shown.
 */
export async function setAllFriends(viewer: SocialViewer, shown: unknown, now = new Date()): Promise<SetAllFriendsResult> {
  if (!hasVerifiedEmail(viewer)) return { ok: false, reason: "email" };
  // Consent covers what was shown: the offer sends the features its summary
  // named, and a list that is not exactly today's set is refused, so a new
  // feature can never be turned on by an offer that did not mention it.
  if (!sameFriendFeatures(shown)) return { ok: false, reason: "features" };
  const rows = (await getSql().query(
    `with before as (
       select p.visible, p.link_face, p.share_holdings, p.share_week, p.staff_hidden_at
       from profiles p
       where p.user_id = $1 and exists (select 1 from handles h where h.user_id = $1)
     ),
     up as (
       update profiles p set
         visible = case when p.staff_hidden_at is null then true else p.visible end,
         hidden_at = case when p.staff_hidden_at is null then null else p.hidden_at end,
         hidden_handle = case when p.staff_hidden_at is null then null else p.hidden_handle end,
         link_face = true,
         share_holdings = true,
         share_week = true,
         updated_at = $2::timestamptz
       where p.user_id = $1 and exists (select 1 from before)
       returning p.staff_hidden_at
     ),
     ins as (
       insert into xp_events (user_id, kind, amount, ref, announced)
       select $1, 'friends_all_on', $3, null, true from up where up.staff_hidden_at is null
       on conflict do nothing
       returning amount
     ),
     paid as (
       update users set xp = xp + (select amount from ins), updated_at = now()
       where id = $1 and exists (select 1 from ins)
       returning xp
     )
     select b.visible, b.link_face, b.share_holdings, b.share_week, b.staff_hidden_at is not null as staff_hidden,
            (select amount from ins) as awarded, (select xp from paid) as xp
     from before b`,
    [viewer.id, now.toISOString(), XP_ACTIONS.friends_all_on.amount],
  )) as {
    visible: boolean;
    link_face: boolean;
    share_holdings: boolean;
    share_week: boolean;
    staff_hidden: boolean;
    awarded: number | null;
    xp: number | null;
  }[];
  const was = rows[0];
  if (!was) return { ok: false, reason: "no username" };
  if (!was.visible && !was.staff_hidden) await socialAudit(viewer.id, "unhide", viewer.id);
  if (!was.link_face) await socialAudit(viewer.id, "link_face_on", viewer.id);
  if (!was.share_holdings) await socialAudit(viewer.id, "share_holdings_on", viewer.id);
  if (!was.share_week) await socialAudit(viewer.id, "share_week_on", viewer.id);
  await socialAudit(viewer.id, "friends_all_on", viewer.id, { xp: was.awarded ?? 0, shown: (shown as string[]).join(",") });
  // Holdings sharing is on now, so the social notice ("See the switch") has
  // nothing to tell this account: closed, as if it had been read.
  await closeSocialNotice(viewer.id);
  let rewards: RewardList = [];
  let xp: number | null = null;
  if (was.awarded) {
    rewards = [{ kind: "friends_all_on", amount: was.awarded }, ...(await flushUnannounced(viewer.id))];
    xp = was.xp;
  }
  return { ok: true, social: await mySocial(viewer, now), rewards, xp };
}

/**
 * The same one time friends_all_on bonus for someone who turns the four
 * friend features on one at a time: called after a switch is turned on
 * (lib/server/social/ops), it pays when that switch was the last one off.
 * One statement, under the same once per account index as the combined
 * button, so the bonus is paid at most once however it is reached, never
 * while staff hide the card, and only with a verified email.
 */
export async function payFriendsAllIfOn(viewer: SocialViewer): Promise<{ rewards: RewardList; xp: number | null }> {
  if (!hasVerifiedEmail(viewer)) return { rewards: [], xp: null };
  const rows = (await getSql().query(
    `with ins as (
       insert into xp_events (user_id, kind, amount, ref, announced)
       select $1, 'friends_all_on', $2, null, true from profiles p
       where p.user_id = $1 and p.visible and p.link_face and p.share_holdings and p.share_week
         and p.staff_hidden_at is null
       on conflict do nothing
       returning amount
     )
     update users set xp = xp + (select amount from ins), updated_at = now()
     where id = $1 and exists (select 1 from ins)
     returning xp, (select amount from ins) as awarded`,
    [viewer.id, XP_ACTIONS.friends_all_on.amount],
  )) as { xp: number; awarded: number }[];
  const paid = rows[0];
  if (!paid) return { rewards: [], xp: null };
  await socialAudit(viewer.id, "friends_all_on", viewer.id, { xp: paid.awarded, by: "switches" });
  return { rewards: [{ kind: "friends_all_on", amount: paid.awarded }, ...(await flushUnannounced(viewer.id))], xp: paid.xp };
}

/** The drawer's view of the viewer's own social state. */
export async function mySocial(viewer: SocialViewer, now = new Date()): Promise<MySocial> {
  const mine = await ownHandle(viewer.id);
  const requests = mine
    ? (((await getSql().query(
        `select count(*)::int as n from friend_requests r
         where r.to_id = $1 and r.status = 'pending'
           and not exists (select 1 from blocks b where b.blocker_id = $1 and b.blocked_id = r.from_id)`,
        [viewer.id],
      )) as { n: number }[])[0]?.n ?? 0)
    : 0;
  const claimed = (((await getSql().query(
    `select exists (select 1 from xp_events where user_id = $1 and kind = 'friends_all_on') as claimed`,
    [viewer.id],
  )) as { claimed: boolean }[])[0]?.claimed ?? false);
  return {
    hasEmail: hasVerifiedEmail(viewer),
    handle: mine?.handle ?? null,
    visible: mine?.visible ?? false,
    linkFace: mine?.linkFace ?? false,
    shareHoldings: mine?.shareHoldings ?? false,
    shareWeek: mine?.shareWeek ?? false,
    nextChangeAt: mine ? nextChange(mine.changedAt, now) : null,
    requests,
    friendsAllClaimed: claimed,
    ...(mine?.staffHidden ? { staffHidden: true as const } : {}),
  };
}
