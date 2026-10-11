import { getSql } from "@/lib/server/db";
import { ACCOUNT_NOTICES, dueNotices } from "@/lib/social-proof";

/**
 * In-app notices said once per account (account_notices): the policy
 * promises to say a change that matters in the app before it applies. A
 * notice is due until the person closes it, on any device; closing it
 * writes one row, once.
 */

/**
 * The notices still due for this account, in ACCOUNT_NOTICES order: not
 * closed, and with something to tell it (lib/social-proof dueNotices). An
 * account created on or after a notice's date, one that accepted the terms
 * a notice announces, or one already sharing its holdings is not told.
 */
export async function pendingNotices(userId: string): Promise<string[]> {
  const rows = (await getSql().query(
    `select u.created_at,
            coalesce(p.share_holdings, false) as share_holdings,
            array(select n.notice from account_notices n where n.user_id = u.id) as seen,
            array(select t.version from terms_acceptances t where t.user_id = u.id) as accepted
     from users u left join profiles p on p.user_id = u.id
     where u.id = $1::uuid`,
    [userId],
  )) as { created_at: Date | string; share_holdings: boolean; seen: string[] | null; accepted: string[] | null }[];
  const row = rows[0];
  if (!row) return [];
  return dueNotices({
    createdAt: new Date(row.created_at),
    seen: new Set(row.seen ?? []),
    acceptedTerms: new Set(row.accepted ?? []),
    sharesHoldings: row.share_holdings,
  });
}

/** Close a notice for this account. False for an id that is not a notice. */
export async function markNoticeSeen(userId: string, notice: unknown): Promise<boolean> {
  if (typeof notice !== "string" || !ACCOUNT_NOTICES.includes(notice)) return false;
  await getSql().query(
    `insert into account_notices (user_id, notice) values ($1::uuid, $2) on conflict (user_id, notice) do nothing`,
    [userId, notice],
  );
  return true;
}
