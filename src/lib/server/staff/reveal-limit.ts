import { getSql } from "@/lib/server/db";
import { deliver } from "@/lib/server/email/send";
import { staffAdminIds } from "@/lib/server/staff-gate";

/**
 * A ceiling on reveals (app/api/staff/reveal): at most REVEALS_PER_HOUR per
 * staff member in any hour, counted from staff_audit, so a fresh session
 * (or a stolen one) cannot pull every address in its fifteen minutes. At
 * REVEALS_ALERT_AT in an hour the other admins get one email about it, a
 * security notice, once per staff member per hour per admin.
 */

export const REVEALS_PER_HOUR = 20;
export const REVEALS_ALERT_AT = 10;

export async function revealsLastHour(staffUserId: string): Promise<number> {
  const rows = (await getSql().query(
    `select count(*)::int as n from staff_audit
      where staff_user_id = $1 and action in ('reveal_email', 'reveal_wallet') and at > now() - interval '1 hour'`,
    [staffUserId],
  )) as { n: number }[];
  return Number(rows[0]?.n ?? 0);
}

/** The once an hour key: staff member, UTC hour, recipient. */
export function revealAlertRef(staffUserId: string, adminId: string, now: Date): string {
  return `${staffUserId}:${now.toISOString().slice(0, 13)}:${adminId}`;
}

/** After a reveal: when this staff member has just reached the alert count, tell every other admin. */
export async function alertOnReveals(
  staffUserId: string,
  count: number,
  { now = new Date(), send = deliver, admins = staffAdminIds() }: { now?: Date; send?: typeof deliver; admins?: readonly string[] } = {},
): Promise<number> {
  if (count < REVEALS_ALERT_AT) return 0;
  let sent = 0;
  for (const admin of admins) {
    if (admin === staffUserId) continue;
    const outcome = await send({
      userId: admin,
      ref: revealAlertRef(staffUserId, admin, now),
      notice: { type: "staff_reveals", count, staff: staffUserId.slice(0, 8) },
    }).catch(() => "failed" as const);
    if (outcome === "sent") sent += 1;
  }
  return sent;
}
