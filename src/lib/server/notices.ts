import { getSql } from "@/lib/server/db";
import { ACCOUNT_NOTICES } from "@/lib/social-proof";

/**
 * In-app notices said once per account (account_notices): the policy
 * promises to say a change that matters in the app before it applies. A
 * notice is due until the person closes it, on any device; closing it
 * writes one row, once.
 */

/** The notices still due for this account, in ACCOUNT_NOTICES order. */
export async function pendingNotices(userId: string): Promise<string[]> {
  const rows = (await getSql().query(`select notice from account_notices where user_id = $1::uuid`, [userId])) as { notice: string }[];
  const seen = new Set(rows.map((row) => row.notice));
  return ACCOUNT_NOTICES.filter((notice) => !seen.has(notice));
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
