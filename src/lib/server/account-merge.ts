import { getSql } from "@/lib/server/db";

/**
 * Phase 3 of docs/plans/account-linking.md: two Berth accounts one person
 * has just proved both of become one. This module decides which one stays
 * and runs the move; the proofs are checked by lib/server/account-merge-
 * route before anything here is called.
 *
 * - The survivor is the account with a verified email; when both or
 *   neither have one, the older (chooseSurvivor).
 * - The move is one database function, `merge_accounts` (db/schema.sql),
 *   so it is one transaction: every row moves, or none does.
 * - Every merge has one `account_merges` row, at most one per absorbed
 *   account ever. A retry of a merge that failed runs it again; a retry of
 *   one that is done changes nothing and answers the same counts.
 * - Nothing moves on chain. The hub wallets stay where they are; the
 *   absorbed account's wallets simply count toward the survivor now.
 */

export type MergeParty = {
  id: string;
  hasEmail: boolean;
  createdAt: string;
  retired: boolean;
};

/** Which of two accounts stays: the one with a verified email, else the older, else the lower id. */
export function chooseSurvivor(a: MergeParty, b: MergeParty): string {
  if (a.hasEmail !== b.hasEmail) return a.hasEmail ? a.id : b.id;
  const at = Date.parse(a.createdAt);
  const bt = Date.parse(b.createdAt);
  if (at !== bt) return at < bt ? a.id : b.id;
  return a.id < b.id ? a.id : b.id;
}

/** What the confirm step shows: totals, never the other account's email or wallets. */
export type MergeTotals = { xp: number; orders: number };

export type MergePlan = {
  survivor: string;
  absorbed: string;
  /** Whether the account that asked is the one that stays. */
  requesterSurvives: boolean;
  /** The survivor's totals once the merge is done (XP counted as the merge counts it). */
  together: MergeTotals;
  /** The absorbed account's username comes along: the survivor has none. */
  usernameComes: boolean;
};

async function parties(ids: readonly string[]): Promise<Map<string, MergeParty>> {
  const rows = (await getSql().query(
    `select id, email is not null as has_email, created_at, retired_into is not null as retired
       from users where id = any($1::uuid[])`,
    [ids],
  )) as { id: string; has_email: boolean; created_at: string | Date; retired: boolean }[];
  return new Map(
    rows.map((row) => [
      row.id,
      { id: row.id, hasEmail: row.has_email, createdAt: new Date(row.created_at).toISOString(), retired: row.retired },
    ]),
  );
}

/**
 * The merge of `requester` and `other` as it would run now, or null when
 * there is nothing to merge: the same account, one missing, or one already
 * retired into another.
 */
export async function planMerge(requester: string, other: string): Promise<MergePlan | null> {
  if (requester === other) return null;
  const found = await parties([requester, other]);
  const a = found.get(requester);
  const b = found.get(other);
  if (!a || !b || a.retired || b.retired) return null;
  const survivor = chooseSurvivor(a, b);
  const absorbed = survivor === requester ? other : requester;
  // The XP the survivor will hold, counted by the very rules merge_accounts
  // moves events by (db/schema.sql): its own, less what it earned for
  // inviting the absorbed account (or for being invited by it); and the
  // absorbed ones that move, a ref naming the absorbed account rewritten
  // to the survivor unless it already has that one.
  const totals = (await getSql().query(
    `with ids as (
       select (select referred_by from users where id = $1) as s_ref, (select referred_by from users where id = $2) as a_ref
     )
     select
       ((select coalesce(sum(amount), 0) from xp_events e, ids
          where e.user_id = $1
            and not (e.kind = 'friend_poured' and e.ref = $2::text)
            and not (e.kind = 'invite_accepted' and ids.s_ref is not distinct from $2::uuid))
        + (select coalesce(sum(amount), 0) from xp_events e
          where e.user_id = $2 and e.ref like $2::text || ':%'
            and not exists (select 1 from xp_events x where x.kind = e.kind and x.ref = $1::text || substr(e.ref, length($2::text) + 1)))
        + (select coalesce(sum(amount), 0) from xp_events e, ids
          where e.user_id = $2
            and coalesce(e.ref, '') not like $2::text || ':%'
            and not (e.kind = 'friend_poured' and e.ref = $1::text)
            and not (e.kind = 'invite_accepted' and ids.a_ref is not distinct from $1::uuid)
            and (e.ref is not null or not exists (
                  select 1 from xp_events x where x.user_id = $1 and x.kind = e.kind and x.ref is null
                    and not (x.kind = 'invite_accepted' and ids.s_ref is not distinct from $2::uuid)))))::int as xp,
       (select count(*) from orders where user_id in ($1, $2))::int as orders,
       (exists (select 1 from handles where user_id = $2) and not exists (select 1 from handles where user_id = $1)) as username_comes`,
    [survivor, absorbed],
  )) as { xp: number; orders: number; username_comes: boolean }[];
  return {
    survivor,
    absorbed,
    requesterSurvives: survivor === requester,
    together: { xp: totals[0]?.xp ?? 0, orders: totals[0]?.orders ?? 0 },
    usernameComes: totals[0]?.username_comes ?? false,
  };
}

export type MergeReason = "email" | "wallet";

export type MergeResult =
  | { ok: true; survivor: string; absorbed: string; moved: Record<string, number>; again: boolean }
  /** The absorbed account was already merged into a different one. */
  | { ok: false; reason: "taken" }
  /** The transaction rolled back; the merge row says 'failed' and a retry runs it again. */
  | { ok: false; reason: "failed" };

/** A merge already done between these two accounts, either way round. */
export async function doneMerge(x: string, y: string): Promise<{ survivor: string; absorbed: string; moved: Record<string, number> } | null> {
  const rows = (await getSql().query(
    `select survivor_id, absorbed_id, moved from account_merges
      where status = 'done' and ((survivor_id = $1 and absorbed_id = $2) or (survivor_id = $2 and absorbed_id = $1))`,
    [x, y],
  )) as { survivor_id: string; absorbed_id: string; moved: Record<string, number> }[];
  const row = rows[0];
  return row ? { survivor: row.survivor_id, absorbed: row.absorbed_id, moved: row.moved ?? {} } : null;
}

/**
 * Runs the merge of `absorbed` into `survivor`. The merge row is written
 * (or reopened, when an earlier try failed) first, then the one
 * transaction runs. Safe to call again with the same pair at any point.
 */
export async function mergeAccounts({
  survivor,
  absorbed,
  reason,
  proofRef = null,
}: {
  survivor: string;
  absorbed: string;
  reason: MergeReason;
  /** Which proof let it happen: 'email:<did>' or 'wallet:<caip10>'. Never a secret. */
  proofRef?: string | null;
}): Promise<MergeResult> {
  const sql = getSql();
  const opened = (await sql.query(
    `insert into account_merges (survivor_id, absorbed_id, reason, proof_ref) values ($1, $2, $3, $4)
     on conflict on constraint account_merges_absorbed_once do update set
       survivor_id = excluded.survivor_id, reason = excluded.reason, proof_ref = excluded.proof_ref,
       status = 'pending', error = null
     where account_merges.status <> 'done'
     returning id`,
    [survivor, absorbed, reason, proofRef],
  )) as { id: string }[];
  if (!opened[0]) {
    const done = await doneMerge(survivor, absorbed);
    if (done && done.survivor === survivor) return { ok: true, survivor, absorbed, moved: done.moved, again: true };
    return { ok: false, reason: "taken" };
  }
  const id = opened[0].id;
  try {
    const rows = (await sql.query(`select merge_accounts($1, $2, $3) as moved`, [id, survivor, absorbed])) as {
      moved: Record<string, number>;
    }[];
    return { ok: true, survivor, absorbed, moved: rows[0]?.moved ?? {}, again: false };
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    console.warn(`[account-merge] merge ${id.slice(0, 8)} failed${typeof code === "string" ? ` (${code})` : ""}`);
    await sql
      .query(`update account_merges set status = 'failed', error = $2 where id = $1 and status <> 'done'`, [
        id,
        typeof code === "string" ? code : "error",
      ])
      .catch(() => undefined);
    // A merge that raced this one and finished first counts as done.
    const done = await doneMerge(survivor, absorbed);
    if (done && done.survivor === survivor) return { ok: true, survivor, absorbed, moved: done.moved, again: true };
    return { ok: false, reason: "failed" };
  }
}
