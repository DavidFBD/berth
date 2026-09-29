import { getSql } from "@/lib/server/db";
import { befriendOnReferral, FRIENDS_MAX } from "@/lib/server/social/friends";

/**
 * Referral is friendship (docs/plans/social.md): from 2026-09-29 a binding
 * referral makes the two accounts friends. This makes the pairs bound before
 * that friends too, by the same rule (befriendOnReferral): no pair across a
 * block, none that would take either side past the cap, one audit row per
 * pair made. Retired rows are skipped; a referrer merged into another
 * account is its survivor. Safe to run again: pairs already friends are
 * counted and left be. Dry run unless `write`.
 */

export type ReferralBackfillReport = {
  /** Live referred accounts with a live referrer. */
  pairs: number;
  alreadyFriends: number;
  blocked: number;
  /** The referrer once declined a request from the referred account. */
  declined: number;
  /** Either side already at FRIENDS_MAX (in a dry run, on today's counts). */
  full: number;
  /** Pairs that would be made (dry run) or were made (write). */
  toMake: number;
  /** Only with write: pairs actually inserted. */
  made: number;
};

type PairRow = { referred: string; referrer: string; friends: boolean; blocked: boolean; declined: boolean; referred_n: number; referrer_n: number };

export async function backfillReferralFriends({ write }: { write: boolean }): Promise<ReferralBackfillReport> {
  const rows = (await getSql().query(
    `with pairs as (
       select u.id as referred, coalesce(r.retired_into, r.id) as referrer
       from users u join users r on r.id = u.referred_by
       where u.retired_into is null
     )
     select p.referred, p.referrer,
       exists (select 1 from friends f where f.a_id = least(p.referred, p.referrer) and f.b_id = greatest(p.referred, p.referrer)) as friends,
       exists (
         select 1 from blocks b where b.blocked_id is not null
           and ((b.blocker_id = p.referred and b.blocked_id = p.referrer) or (b.blocker_id = p.referrer and b.blocked_id = p.referred))
       ) as blocked,
       exists (
         select 1 from friend_requests q where q.from_id = p.referred and q.to_id = p.referrer
           and (q.status = 'declined' or (q.status = 'withdrawn' and q.responded_at is not null))
       ) as declined,
       (select count(*)::int from friends f where f.a_id = p.referred or f.b_id = p.referred) as referred_n,
       (select count(*)::int from friends f where f.a_id = p.referrer or f.b_id = p.referrer) as referrer_n
     from pairs p
     where p.referred <> p.referrer
     order by p.referrer, p.referred`,
  )) as PairRow[];

  const report: ReferralBackfillReport = { pairs: rows.length, alreadyFriends: 0, blocked: 0, declined: 0, full: 0, toMake: 0, made: 0 };
  // A dry run keeps its own tally of the pairs it would add, so a referrer
  // with many invitees reaches the cap in the plan as it would in the write.
  const added = new Map<string, number>();
  const count = (id: string, base: number) => base + (added.get(id) ?? 0);
  for (const row of rows) {
    if (row.friends) report.alreadyFriends += 1;
    else if (row.blocked) report.blocked += 1;
    else if (row.declined) report.declined += 1;
    else if (count(row.referred, row.referred_n) >= FRIENDS_MAX || count(row.referrer, row.referrer_n) >= FRIENDS_MAX) report.full += 1;
    else {
      report.toMake += 1;
      added.set(row.referred, (added.get(row.referred) ?? 0) + 1);
      added.set(row.referrer, (added.get(row.referrer) ?? 0) + 1);
      if (write && (await befriendOnReferral(row.referred, row.referrer, "backfill"))) report.made += 1;
    }
  }
  return report;
}
