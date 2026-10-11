import { getSql } from "@/lib/server/db";

/**
 * Who is who, in the social tables. Every route in lib/server/social starts
 * here: the viewer (the account row the rewards prologue resolved), and a
 * target reached only by its folded username. The one rule of visibility is
 * stated here once, as SQL, so a card, a Salute and a friend request can
 * never disagree about whether someone can be seen.
 */

/** The part of an account row the social rules read. */
export type SocialViewer = {
  id: string;
  /** Set only from Privy's verified address (lib/server/accounts setEmail). */
  email: string | null;
};

export const hasVerifiedEmail = (viewer: SocialViewer) => viewer.email !== null;

/**
 * Whether the card of the account `userId` (an SQL expression) is on for
 * others: the switch is on and the account still has a verified email. An
 * account whose email is unlinked keeps its username, but its card is off
 * until an email is verified again (the email is the account; a profile
 * without one is nobody's to vouch for). The one statement of it;
 * VISIBLE_SQL, the board and the friends lists all ask this.
 */
export const SHOWN_SQL = (userId: string) => `
  (exists (select 1 from profiles p where p.user_id = ${userId} and p.visible)
   and exists (select 1 from users e where e.id = ${userId} and e.email is not null))`;

/**
 * A target `t` (a handles row) is visible to viewer `$v` when its card is
 * on and no block stands between them in either direction; the viewer
 * always sees their own card. `$v` may be null: signed out, only the
 * switch matters.
 */
export const VISIBLE_SQL = (target: string, viewer: string) => `
  (
    ${target}.user_id = ${viewer}
    or (
      ${SHOWN_SQL(`${target}.user_id`)}
      and (
        ${viewer} is null
        or not exists (
          select 1 from blocks b
          where (b.blocker_id = ${target}.user_id and b.blocked_id = ${viewer})
             or (b.blocker_id = ${viewer} and b.blocked_id = ${target}.user_id)
        )
      )
    )
  )`;

/** The account behind a folded username that `viewerId` may see, or null for any reason at all. */
export async function visibleTarget(viewerId: string | null, norm: string): Promise<string | null> {
  const rows = (await getSql().query(
    `select h.user_id from handles h where h.handle_norm = $1 and ${VISIBLE_SQL("h", "$2::uuid")}`,
    [norm, viewerId],
  )) as { user_id: string }[];
  return rows[0]?.user_id ?? null;
}

/**
 * The account behind a folded username whatever its visibility. Only for
 * acts on the viewer's own side (block, unblock, report, and the friend
 * actions on a relation the viewer already has), whose answers never say
 * whether the name exists.
 */
export async function anyTarget(norm: string): Promise<string | null> {
  const rows = (await getSql().query(`select user_id from handles where handle_norm = $1`, [norm])) as { user_id: string }[];
  return rows[0]?.user_id ?? null;
}

export type OwnHandle = { handle: string; norm: string; changedAt: string; createdAt: string; visible: boolean; linkFace: boolean; shareHoldings: boolean; shareWeek: boolean; staffHidden: boolean };

export async function ownHandle(userId: string): Promise<OwnHandle | null> {
  const rows = (await getSql().query(
    `select h.handle, h.handle_norm, h.changed_at, h.created_at, coalesce(p.visible, true) as visible,
       coalesce(p.link_face, false) as link_face, coalesce(p.share_holdings, false) as share_holdings,
       coalesce(p.share_week, false) as share_week, p.staff_hidden_at is not null as staff_hidden
     from handles h left join profiles p on p.user_id = h.user_id
     where h.user_id = $1`,
    [userId],
  )) as { handle: string; handle_norm: string; changed_at: string; created_at: string; visible: boolean; link_face: boolean; share_holdings: boolean; share_week: boolean; staff_hidden: boolean }[];
  const row = rows[0];
  if (!row) return null;
  return {
    handle: row.handle,
    norm: row.handle_norm,
    changedAt: new Date(row.changed_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
    visible: row.visible,
    linkFace: row.link_face,
    shareHoldings: row.share_holdings,
    shareWeek: row.share_week,
    staffHidden: row.staff_hidden,
  };
}
