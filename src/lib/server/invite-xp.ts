import { getSql } from "@/lib/server/db";
import { awardXp } from "@/lib/server/accounts";
import { personAccounts } from "@/lib/server/campaigns/store";
import {
  SET_UP_SQL,
  existingCustomer,
  lastSeen,
  onboarded,
  personEmails,
  personWallets,
  sameHands,
} from "@/lib/server/campaigns/eligibility";

/**
 * Invite XP: the inviter earns friend_stayed (lib/xp) for a friend who sets
 * up and stays, never for a friend's buy. Run each morning (lib/server
 * morning), database only, in two passes:
 *
 * 1. Seen set up. Every live invited account (users.referred_by) that is
 *    set up as the invite campaign defines it (SET_UP_SQL: a verified
 *    email, a username and a home wallet) gets an invite_setups row,
 *    set_up_at the morning it was first seen so. A friend whose inviter
 *    was already paid for them (friend_poured, the first buy rule retired
 *    2026-10-05, or friend_stayed on any account of theirs) is closed at
 *    once as 'paid_before'.
 * 2. Stayed. A row INVITE_STAY_DAYS after set_up_at is judged on the
 *    campaign's own signal, the last signed in visit (lastSeen, any of the
 *    friend's accounts), held to the words the inviter reads ("still uses
 *    Berth a week later"): a visit at least INVITE_SEEN_AFTER_DAYS after
 *    set_up_at. Yes, and still set up: the inviter is paid friend_stayed, parked
 *    unannounced for their next visit, and the row closes as 'paid'. Not
 *    yet: the row waits and is asked again on later mornings, since a
 *    friend who comes back later has stayed too.
 *
 * Before paying, the invite campaign's own farming guards are asked of
 * the two people: self_invite (sameHands: one person by merge, a shared
 * wallet or a shared folded email) and existing_customer (any account of
 * the friend older than the invite window before theirs, or an order from
 * before it). Either closes the row unpaid. An inviter is paid for at most
 * INVITE_XP_MONTHLY_CAP friends a UTC calendar month; a friend past it
 * waits, and is paid on a later morning in the next month.
 *
 * Each friend pays once: friend_stayed's ref is the friend's id, unique
 * per kind (xp_events_kind_ref_unique), and a person already paid for on
 * any of their accounts pays nothing more. Past friend_poured awards are
 * never touched. Nothing here reads an order or gives anything for any
 * action on X.
 */

const DAY_MS = 86_400_000;
/** How long after setting up a friend is judged. */
export const INVITE_STAY_DAYS = 7;
/** The visit that counts: at least this long after setting up. */
export const INVITE_SEEN_AFTER_DAYS = 6;

/** Whether the friend was still using Berth a week on: a visit at least INVITE_SEEN_AFTER_DAYS after set up. Pure. */
export function stayedAWeek(setUpAt: Date, seen: Date | null): boolean {
  return seen !== null && seen.getTime() >= setUpAt.getTime() + INVITE_SEEN_AFTER_DAYS * DAY_MS;
}
/** Most friend_stayed awards one inviter earns in a UTC calendar month. */
export const INVITE_XP_MONTHLY_CAP = 10;
/** Most rows each pass touches in one morning. */
export const INVITE_XP_LIMIT = 200;

export type InviteXpSummary = { recorded: number; paid: number; paidBefore: number; refused: number; capped: number; waiting: number };

type Outcome = "paid" | "paid_before" | "self_invite" | "existing_customer";

/** One person's marks, as the campaign guards compare them. */
async function marks(accounts: string[]) {
  return { accounts, wallets: await personWallets(accounts), emails: await personEmails(accounts) };
}

/** Friends this inviter was paid friend_stayed for in `now`'s UTC calendar month. */
async function paidThisMonth(inviterId: string, now: Date): Promise<number> {
  const rows = (await getSql().query(
    `select count(*)::int as n from invite_setups s join users u on u.id = s.friend_id
      where u.referred_by = $1 and s.outcome = 'paid'
        and date_trunc('month', s.settled_at at time zone 'UTC') = date_trunc('month', $2::timestamptz at time zone 'UTC')`,
    [inviterId, now.toISOString()],
  )) as { n: number }[];
  return rows[0]?.n ?? 0;
}

const PAID_KINDS = ["friend_poured", "friend_stayed"];

/** Whether the inviter of this person was already paid for them, on any of their accounts. */
async function paidBefore(accountIds: readonly string[]): Promise<boolean> {
  const rows = (await getSql().query(
    `select 1 from xp_events where kind = any($1::text[]) and ref = any($2::text[]) limit 1`,
    [PAID_KINDS, accountIds],
  )) as unknown[];
  return rows.length > 0;
}

export async function runInviteXpStep({
  now = new Date(),
  deadline = Number.POSITIVE_INFINITY,
}: { now?: Date; deadline?: number } = {}): Promise<InviteXpSummary> {
  const sql = getSql();
  const summary: InviteXpSummary = { recorded: 0, paid: 0, paidBefore: 0, refused: 0, capped: 0, waiting: 0 };

  // 1. Seen set up.
  const recorded = (await sql.query(
    `insert into invite_setups (friend_id, set_up_at, settled_at, outcome)
     select u.id, $1::timestamptz,
            case when before.paid then $1::timestamptz end,
            case when before.paid then 'paid_before' end
       from users u
       cross join lateral (
         select exists (
           select 1 from xp_events e
            where e.kind = any($3::text[])
              and e.ref in (select p.id::text from users p where p.id = u.id or p.retired_into = u.id)
         ) as paid
       ) before
      where u.referred_by is not null and u.referred_by <> u.id and u.retired_into is null
        and ${SET_UP_SQL("u")}
        and not exists (select 1 from invite_setups s where s.friend_id = u.id)
      limit $2
     on conflict (friend_id) do nothing
     returning outcome`,
    [now.toISOString(), INVITE_XP_LIMIT, PAID_KINDS],
  )) as { outcome: string | null }[];
  summary.recorded = recorded.length;
  summary.paidBefore += recorded.filter((row) => row.outcome === "paid_before").length;

  // 2. Stayed.
  const due = (await sql.query(
    `select s.friend_id, s.set_up_at, u.referred_by, u.created_at
       from invite_setups s join users u on u.id = s.friend_id
      where s.settled_at is null and u.retired_into is null and u.referred_by is not null
        and s.set_up_at <= $1::timestamptz - make_interval(days => $2::int)
      order by s.checked_at nulls first, s.set_up_at
      limit $3`,
    [now.toISOString(), INVITE_STAY_DAYS, INVITE_XP_LIMIT],
  )) as { friend_id: string; set_up_at: string | Date; referred_by: string; created_at: string | Date }[];

  for (const row of due) {
    if (Date.now() >= deadline) break;
    const setUpAt = new Date(row.set_up_at);
    const accounts = await personAccounts(row.friend_id);
    if (await paidBefore(accounts)) {
      await close(row.friend_id, "paid_before", now);
      summary.paidBefore += 1;
      continue;
    }
    const stayed =
      (await onboarded(row.friend_id)) &&
      stayedAWeek(setUpAt, await lastSeen(accounts));
    if (!stayed) {
      await wait(row.friend_id, now);
      summary.waiting += 1;
      continue;
    }
    const refusal = sameHands(await marks(accounts), await marks(await personAccounts(row.referred_by)))
      ? "self_invite"
      : (await existingCustomer(accounts, new Date(row.created_at)))
        ? "existing_customer"
        : null;
    if (refusal) {
      await close(row.friend_id, refusal, now);
      summary.refused += 1;
      continue;
    }
    if ((await paidThisMonth(row.referred_by, now)) >= INVITE_XP_MONTHLY_CAP) {
      await wait(row.friend_id, now);
      summary.capped += 1;
      continue;
    }
    const award = await awardXp(row.referred_by, "friend_stayed", row.friend_id, { announced: false });
    await close(row.friend_id, award.awarded > 0 ? "paid" : "paid_before", now);
    if (award.awarded > 0) summary.paid += 1;
    else summary.paidBefore += 1;
  }
  return summary;
}

async function wait(friendId: string, now: Date): Promise<void> {
  await getSql().query(`update invite_setups set checked_at = $2 where friend_id = $1`, [friendId, now.toISOString()]);
}

async function close(friendId: string, outcome: Outcome, now: Date): Promise<void> {
  await getSql().query(`update invite_setups set settled_at = $2, outcome = $3 where friend_id = $1 and settled_at is null`, [
    friendId,
    now.toISOString(),
    outcome,
  ]);
}
