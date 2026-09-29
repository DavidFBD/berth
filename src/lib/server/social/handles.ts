import { getSql } from "@/lib/server/db";
import {
  HANDLE_CHANGE_DAYS,
  HANDLE_RETIRE_DAYS,
  parseHandle,
  refusedName,
  type HandleRefusal,
} from "@/lib/handle";
import type { HandleCheck, MySocial } from "@/lib/social-types";
import { socialAudit } from "@/lib/server/social/audit";
import { hasVerifiedEmail, ownHandle, type SocialViewer } from "@/lib/server/social/people";

/**
 * Picking, changing and hiding a username. The rulebook (lib/handle) decides
 * what a name is; this module decides whether this account may have this one
 * now: a verified email, a name nobody else holds or has just dropped, and
 * one change per 30 days, any change at all (saving the same name again is
 * not a change).
 */

const DAY_MS = 86_400_000;

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
  if (refused === "reserved") return { ok: false, reason: "taken" };
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

export type SetHandleResult = { ok: true; social: MySocial } | { ok: false; reason: HandleRefusal };

/**
 * Picks or changes the username, and with the first pick turns the card on.
 * One statement: the upsert only changes an existing name when the 30 days
 * have passed (saving the very same name changes nothing); the old fold is held 90 days for this
 * account; the profile row appears with the first name. A race for the same
 * name ends at the unique fold, and the loser hears "taken".
 */
export async function setHandle(viewer: SocialViewer, value: unknown, now = new Date()): Promise<SetHandleResult> {
  const check = await checkHandle(viewer, value, now);
  if (!check.ok) return check;
  const parsed = parseHandle(check.handle);
  if (!parsed.ok) return parsed;
  const before = await ownHandle(viewer.id);
  let rows: { handle: string }[];
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
         returning handle, handle_norm
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
       select handle from up`,
      [viewer.id, parsed.handle, parsed.norm, now.toISOString(), HANDLE_CHANGE_DAYS, HANDLE_RETIRE_DAYS],
    )) as { handle: string }[];
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
  return { ok: true, social: await mySocial(viewer, now) };
}

/** "Hide my card": one switch. Hidden reads exactly like missing, to everyone else. */
export async function setVisible(viewer: SocialViewer, visible: boolean, now = new Date()): Promise<MySocial | null> {
  const rows = (await getSql().query(
    `update profiles set visible = $2,
       hidden_at = case when $2 then null else $3::timestamptz end,
       hidden_handle = case when $2 then null else (select handle from handles where user_id = $1) end,
       updated_at = $3::timestamptz
     where user_id = $1 and visible is distinct from $2
     returning visible`,
    [viewer.id, visible, now.toISOString()],
  )) as { visible: boolean }[];
  if (rows[0]) await socialAudit(viewer.id, visible ? "unhide" : "hide", viewer.id);
  const mine = await ownHandle(viewer.id);
  return mine ? mySocial(viewer, now) : null;
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
  return {
    hasEmail: hasVerifiedEmail(viewer),
    handle: mine?.handle ?? null,
    visible: mine?.visible ?? false,
    nextChangeAt: mine ? nextChange(mine.changedAt, now) : null,
    requests,
  };
}
