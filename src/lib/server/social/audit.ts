import { getSql } from "@/lib/server/db";

/**
 * The social audit trail (`social_audit`): who did what to whom, for
 * moderation and for the metrics in docs/plans/social.md. `meta` holds names
 * at the time and nothing else: never an email, a wallet or a token. A
 * failed write is logged and swallowed; the audit never fails the action.
 */

export type SocialAction =
  | "handle_set"
  | "handle_changed"
  | "hide"
  | "unhide"
  | "link_face_on"
  | "link_face_off"
  | "share_holdings_on"
  | "share_holdings_off"
  | "share_week_on"
  | "share_week_off"
  /** "Turn on all friend features"; meta.xp is what it paid (0 after the first time). */
  | "friends_all_on"
  | "salute"
  | "unsalute"
  | "friend_request"
  | "friend_cancel"
  | "friend_accept"
  | "friend_decline"
  | "friend_remove"
  | "friend_referral"
  /** A request to the founder, made at once (lib/server/social/founder). */
  | "friend_founder"
  | "link_new"
  | "block"
  | "unblock"
  | "report";

export async function socialAudit(
  actorId: string,
  action: SocialAction,
  targetId: string | null = null,
  meta: Record<string, string | number | boolean> = {},
): Promise<void> {
  try {
    await getSql().query(
      `insert into social_audit (actor_id, action, target_id, meta) values ($1, $2, $3, $4::jsonb)`,
      [actorId, action, targetId, JSON.stringify(meta)],
    );
  } catch (error) {
    console.warn("[social] audit write failed:", error instanceof Error ? error.message : error);
  }
}
