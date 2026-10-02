import { isPathStep, pathEligible, withSkip, withoutSkip, type FirstPathResponse, type PathStep } from "@/lib/first-path";

export type { FirstPathResponse } from "@/lib/first-path";
import { CASH_SYMBOL } from "@/lib/nudge";
import { getSql } from "@/lib/server/db";
import { takeRatePlace } from "@/lib/server/oauth/rate-limit";

/**
 * Writes per account per hour. A person skips, unskips and finishes a
 * handful of times; this only stops a loop. Reads are not limited, as the
 * profile route's are not.
 */
export const FIRST_PATH_WRITES_PER_HOUR = 60;

/** Takes one write place for the account this hour; false once the limit is reached. */
export function firstPathWriteAllowed(userId: string, now = new Date()): Promise<boolean> {
  return takeRatePlace("first-path", userId, FIRST_PATH_WRITES_PER_HOUR, now);
}

/**
 * The guided path's server side (lib/first-path is the rulebook). One read
 * answers everything the server knows: the progress record (first_paths)
 * and the facts other tables already hold, so a step is never decided by a
 * click alone and the path holds across devices. The only facts the client
 * reports are the two no table can prove: that the account held enough to
 * buy (the balances live on chain) and that a friend link was shared.
 * Nothing here pays XP: each step's XP comes from its own award path.
 */

export type FirstPathWrite =
  | { kind: "skip"; step: PathStep }
  | { kind: "unskip"; step: PathStep }
  | { kind: "funded" }
  | { kind: "invited" }
  | { kind: "finish" };

/** The one write a request body asks for, or null for a plain read. Anything unknown is a read. */
export function parseFirstPathWrite(body: Record<string, unknown>): FirstPathWrite | null {
  if (isPathStep(body.skip)) return { kind: "skip", step: body.skip };
  if (isPathStep(body.unskip)) return { kind: "unskip", step: body.unskip };
  if (body.funded === true) return { kind: "funded" };
  if (body.invited === true) return { kind: "invited" };
  if (body.finish === true) return { kind: "finish" };
  return null;
}

type Row = {
  created_at: string | Date;
  avatar_set: boolean;
  has_email: boolean;
  referred: boolean;
  username_set: boolean;
  first_buy: boolean;
  friend_made: boolean;
  skipped: string[] | null;
  funded_at: string | Date | null;
  invite_shared_at: string | Date | null;
  finished_at: string | Date | null;
};

export async function readFirstPath(userId: string): Promise<FirstPathResponse | null> {
  const rows = (await getSql().query(
    `select u.created_at,
            u.avatar_id is not null as avatar_set,
            u.email is not null as has_email,
            u.referred_by is not null as referred,
            exists (select 1 from handles h where h.user_id = u.id) as username_set,
            exists (select 1 from orders o
                     where o.user_id = u.id and o.direction = 'buy' and o.listing_symbol <> $2
                       and (o.fill_tx is not null or o.filled_at is not null)) as first_buy,
            (exists (select 1 from users r where r.referred_by = u.id)
              or exists (select 1 from friend_requests q where q.from_id = u.id)
              or exists (select 1 from friends f
                          where (f.a_id = u.id or f.b_id = u.id)
                            and (u.referred_by is null
                                 or (case when f.a_id = u.id then f.b_id else f.a_id end) <> u.referred_by))) as friend_made,
            p.skipped, p.funded_at, p.invite_shared_at, p.finished_at
       from users u left join first_paths p on p.user_id = u.id
      where u.id = $1`,
    [userId, CASH_SYMBOL],
  )) as Row[];
  const row = rows[0];
  if (!row) return null;
  return {
    eligible: pathEligible(new Date(row.created_at).getTime()),
    skipped: (row.skipped ?? []).filter(isPathStep),
    finished: row.finished_at !== null,
    referred: row.referred,
    facts: {
      avatarSet: row.avatar_set,
      usernameSet: row.username_set,
      hasEmail: row.has_email,
      funded: row.funded_at !== null,
      firstBuy: row.first_buy,
      // A friend made other than the one who invited this account, a request
      // sent, someone who joined on this account's code, or a link shared.
      inviteSent: row.friend_made || row.invite_shared_at !== null,
    },
  };
}

/**
 * Applies one write. Each is idempotent: a skip twice is one skip, the
 * dates keep their first value, and a finish stays finished.
 */
export async function writeFirstPath(userId: string, write: FirstPathWrite): Promise<void> {
  const sql = getSql();
  if (write.kind === "skip" || write.kind === "unskip") {
    // Read, change, write: the list is at most five short words, and two
    // racing skips of different steps from one person are not a real case;
    // the write keeps the latest list either way.
    const rows = (await sql.query(`select skipped from first_paths where user_id = $1`, [userId])) as { skipped: string[] }[];
    const now = (rows[0]?.skipped ?? []).filter(isPathStep);
    const next = write.kind === "skip" ? withSkip(now, write.step) : withoutSkip(now, write.step);
    await sql.query(
      `insert into first_paths (user_id, skipped) values ($1, $2)
       on conflict (user_id) do update set skipped = excluded.skipped, updated_at = now()`,
      [userId, next],
    );
    return;
  }
  const column = write.kind === "funded" ? "funded_at" : write.kind === "invited" ? "invite_shared_at" : "finished_at";
  await sql.query(
    `insert into first_paths (user_id, ${column}) values ($1, now())
     on conflict (user_id) do update set ${column} = coalesce(first_paths.${column}, now()), updated_at = now()`,
    [userId],
  );
}
