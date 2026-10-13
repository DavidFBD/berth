import { getSql } from "@/lib/server/db";
import { FEEDBACK_PROMPT_ID, feedbackPromptDue } from "@/lib/feedback";
import { ACCOUNT_NOTICES, dueNotices, FIRST_FRIEND_NOTICE_ID } from "@/lib/social-proof";

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
 *
 * The board's feedback ask (lib/feedback FEEDBACK_PROMPT_ID) rides last, by
 * its own rule (feedbackPromptDue): a completed buy a day old or more, and
 * no feedback ever sent. A buy is completed as everywhere else on the
 * server (lib/server/first-stock): a fill transaction or a fill time.
 */
export async function pendingNotices(userId: string, now = Date.now()): Promise<string[]> {
  const rows = (await getSql().query(
    `select u.created_at,
            coalesce(p.share_holdings, false) as share_holdings,
            array(select n.notice from account_notices n where n.user_id = u.id) as seen,
            array(select t.version from terms_acceptances t where t.user_id = u.id) as accepted,
            (select min(coalesce(o.filled_at, o.placed_at, o.created_at)) from orders o
              where o.user_id = u.id and o.direction = 'buy'
                and (o.fill_tx is not null or o.filled_at is not null)) as first_buy_at,
            (exists (select 1 from feedback f where f.user_id = u.id)
              or exists (select 1 from xp_events x where x.user_id = u.id and x.kind = 'feedback_first')) as sent_feedback
     from users u left join profiles p on p.user_id = u.id
     where u.id = $1::uuid`,
    [userId],
  )) as {
    created_at: Date | string;
    share_holdings: boolean;
    seen: string[] | null;
    accepted: string[] | null;
    first_buy_at: Date | string | null;
    sent_feedback: boolean;
  }[];
  const row = rows[0];
  if (!row) return [];
  const seen = new Set(row.seen ?? []);
  const due = dueNotices({
    createdAt: new Date(row.created_at),
    seen,
    acceptedTerms: new Set(row.accepted ?? []),
    sharesHoldings: row.share_holdings,
  });
  const ask = feedbackPromptDue(
    {
      closed: seen.has(FEEDBACK_PROMPT_ID),
      firstBuyAt: row.first_buy_at === null ? null : new Date(row.first_buy_at).getTime(),
      sentFeedback: row.sent_feedback,
    },
    now,
  );
  return ask ? [...due, FEEDBACK_PROMPT_ID] : due;
}

/** Close a notice for this account (the first friend offer included). False for an id that is not a notice. */
export async function markNoticeSeen(userId: string, notice: unknown): Promise<boolean> {
  if (typeof notice !== "string" || !(ACCOUNT_NOTICES.includes(notice) || notice === FEEDBACK_PROMPT_ID || notice === FIRST_FRIEND_NOTICE_ID)) return false;
  await getSql().query(
    `insert into account_notices (user_id, notice) values ($1::uuid, $2) on conflict (user_id, notice) do nothing`,
    [userId, notice],
  );
  return true;
}
