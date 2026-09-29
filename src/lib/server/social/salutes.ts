import { getSql } from "@/lib/server/db";
import { lookupKey } from "@/lib/handle";
import type { CardAnswer } from "@/lib/social-types";
import { socialAudit } from "@/lib/server/social/audit";
import { NOT_FOUND, readCardOf } from "@/lib/server/social/cards";
import { hasVerifiedEmail, visibleTarget, type SocialViewer } from "@/lib/server/social/people";

/**
 * A Salute: one per giver per card, revocable, from an account with a
 * verified email, to anyone whose card the giver can open, never to oneself.
 * No XP either way (ADR-0005). Revoking keeps the row; saluting again clears
 * `revoked_at` and keeps `first_at`, so a toggle never mints a new salute
 * point on the friends board.
 *
 * Answers with the refreshed card, or NOT_FOUND for any card that cannot be
 * seen, so a Salute is no better an oracle than opening the card.
 */
export async function setSalute(viewer: SocialViewer, handle: unknown, on: boolean): Promise<CardAnswer> {
  const norm = lookupKey(handle);
  const target = norm ? await visibleTarget(viewer.id, norm) : null;
  if (!target) return NOT_FOUND;
  if (target === viewer.id || !hasVerifiedEmail(viewer)) return readCardOf(viewer, target);
  const changed = on
    ? ((await getSql().query(
        `insert into salutes (giver_id, recipient_id) values ($1, $2)
         on conflict (giver_id, recipient_id) do update set revoked_at = null
           where salutes.revoked_at is not null
         returning 1`,
        [viewer.id, target],
      )) as unknown[])
    : ((await getSql().query(
        `update salutes set revoked_at = now() where giver_id = $1 and recipient_id = $2 and revoked_at is null returning 1`,
        [viewer.id, target],
      )) as unknown[]);
  if (changed.length > 0) await socialAudit(viewer.id, on ? "salute" : "unsalute", target);
  return readCardOf(viewer, target);
}
