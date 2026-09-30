import { getSql } from "@/lib/server/db";
import { emailValue } from "@/lib/server/identities";
import {
  DEFAULT_EMAIL_PREFS,
  SWITCHABLE_KINDS,
  type EmailPrefs,
  type SwitchableKind,
} from "@/lib/email-kinds";

/**
 * The email tables (db/schema.sql): preferences, suppressions and the send
 * log. Every read of the address happens at send time and is never cached,
 * so a merge or a changed primary email is followed at once.
 */

/**
 * The one rule for where a person's notices go: their primary email
 * identity (user_identities, kind email, is_primary; at most one per
 * account). `user` is the SQL expression for the account's id. Every
 * reader of the address uses it (primaryEmail at send time, the weekly
 * summary's picking query), normalised the same way afterwards
 * (sendableAddress), so no query picks a person the send would refuse.
 */
export const primaryEmailSql = (user: string) =>
  `select value from user_identities where user_id = ${user} and kind = 'email' and is_primary limit 1`;

/** A stored address as a send reads it: normalised, or null when it is not an address at all. */
export function sendableAddress(value: string | null | undefined): string | null {
  return emailValue(value);
}

/** The account's verified primary email (primaryEmailSql), normalised, or null. */
export async function primaryEmail(userId: string): Promise<string | null> {
  const rows = (await getSql().query(primaryEmailSql("$1"), [userId])) as { value: string }[];
  return sendableAddress(rows[0]?.value);
}

/** Of these normalised addresses, the ones on the suppression list, in one read. */
export async function suppressedAmong(addresses: readonly string[]): Promise<Set<string>> {
  if (addresses.length === 0) return new Set();
  const rows = (await getSql().query(`select address from email_suppressions where address = any($1::text[])`, [addresses])) as {
    address: string;
  }[];
  return new Set(rows.map((row) => row.address));
}

export async function readPrefs(userId: string): Promise<EmailPrefs> {
  const rows = (await getSql().query(`select kind, enabled from email_prefs where user_id = $1`, [userId])) as {
    kind: string;
    enabled: boolean;
  }[];
  const prefs: EmailPrefs = { ...DEFAULT_EMAIL_PREFS };
  for (const row of rows) {
    if ((SWITCHABLE_KINDS as readonly string[]).includes(row.kind)) prefs[row.kind as SwitchableKind] = row.enabled;
  }
  return prefs;
}

export async function setPref(userId: string, kind: SwitchableKind, enabled: boolean): Promise<void> {
  await getSql().query(
    `insert into email_prefs (user_id, kind, enabled) values ($1, $2, $3)
     on conflict (user_id, kind) do update set enabled = excluded.enabled, updated_at = now()`,
    [userId, kind, enabled],
  );
}

export type SuppressionReason = "bounce" | "complaint" | "suppressed";

export async function isSuppressed(address: string): Promise<boolean> {
  const value = emailValue(address);
  if (!value) return true;
  const rows = (await getSql().query(`select 1 from email_suppressions where address = $1`, [value])) as unknown[];
  return rows.length > 0;
}

/** Marks an address undeliverable. The first reason stays; a complaint outranks a bounce. */
export async function suppress(address: string, reason: SuppressionReason, providerId: string | null): Promise<boolean> {
  const value = emailValue(address);
  if (!value) return false;
  await getSql().query(
    `insert into email_suppressions (address, reason, provider_id) values ($1, $2, $3)
     on conflict (address) do update set reason = excluded.reason, provider_id = excluded.provider_id, at = now()
       where excluded.reason = 'complaint' and email_suppressions.reason <> 'complaint'`,
    [value, reason, providerId],
  );
  return true;
}

/** A notice's stored form while it waits (email_sends.notice): the notice itself, never the address. */
export type StoredNotice = Record<string, unknown> & { type: string };

export type Claim = { id: string } | "duplicate" | "daily_cap";

/**
 * Claims the one send for (type, ref), in one statement. Answers the row's
 * id when this call may send, "duplicate" when another call already has
 * (sent, or still going). A failed send may be claimed again, so a retry
 * of the event retries it. A friend request also takes the account's one
 * slot for the UTC day (the email_sends_friend_daily index), so two
 * requests at the same moment still send one email: "daily_cap".
 */
export async function claimSend(userId: string, type: string, ref: string, notice: StoredNotice | null = null): Promise<Claim> {
  const sql = getSql();
  if (type === "friend_request") {
    const rows = (await sql.query(
      `insert into email_sends (user_id, type, ref, notice, day_key)
       values ($1, $2, $3, $4::jsonb, to_char(now() at time zone 'UTC', 'YYYY-MM-DD'))
       on conflict do nothing
       returning id`,
      [userId, type, ref, notice ? JSON.stringify(notice) : null],
    )) as { id: string }[];
    if (rows[0]) return { id: rows[0].id };
    const same = (await sql.query(`select 1 from email_sends where type = $1 and ref = $2`, [type, ref])) as unknown[];
    return same.length > 0 ? "duplicate" : "daily_cap";
  }
  const rows = (await sql.query(
    `insert into email_sends (user_id, type, ref, notice) values ($1, $2, $3, $4::jsonb)
     on conflict on constraint email_sends_type_ref do update set
       status = 'pending', error = null, notice = excluded.notice, attempts = email_sends.attempts + 1, created_at = now()
       where email_sends.status = 'failed'
     returning id`,
    [userId, type, ref, notice ? JSON.stringify(notice) : null],
  )) as { id: string }[];
  return rows[0] ? { id: rows[0].id } : "duplicate";
}

export async function finishSend(
  id: string,
  outcome: { ok: true; providerId: string | null } | { ok: false; error: string } | { later: string },
): Promise<void> {
  const sql = getSql();
  if ("later" in outcome) {
    // Still pending, notice kept: the next pass tries it again.
    await sql.query(`update email_sends set error = $2 where id = $1`, [id, outcome.later.slice(0, 80)]);
  } else if (outcome.ok) {
    await sql.query(`update email_sends set status = 'sent', provider_id = $2, error = null, notice = null where id = $1`, [
      id,
      outcome.providerId,
    ]);
  } else {
    await sql.query(`update email_sends set status = 'failed', error = $2, notice = null where id = $1`, [id, outcome.error.slice(0, 80)]);
  }
}

/**
 * Records that (type, ref) was not sent and why, without sending: a row
 * finished as 'failed' with `reason` as its error, so it counts against
 * no cap and a later claim may still take it (claimSend reclaims a failed
 * row). A row already sent or under way is left alone. The weekly summary
 * uses it so a person it tried is not picked first again ('empty': the
 * week had nothing to say, and the week is done for them; 'build' and the
 * rest: tried again another morning, after everyone not yet tried).
 */
export async function recordUnsent(userId: string, type: string, ref: string, reason: string): Promise<void> {
  await getSql().query(
    `insert into email_sends (user_id, type, ref, status, error) values ($1, $2, $3, 'failed', $4)
     on conflict on constraint email_sends_type_ref do update set
       error = excluded.error, notice = null, attempts = email_sends.attempts + 1, created_at = now()
       where email_sends.status = 'failed'`,
    [userId, type, ref, reason.slice(0, 80)],
  );
}

/** Sends claimed today (UTC), sent or pending; of one type when given. */
export async function sendsToday(type?: string): Promise<number> {
  const rows = (await getSql().query(
    `select count(*)::int as n from email_sends
      where status in ('sent', 'pending') and created_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'
        ${type ? "and type = $1" : ""}`,
    type ? [type] : [],
  )) as { n: number }[];
  return rows[0]?.n ?? 0;
}

export const STALE_PENDING_MINUTES = 10;
export const MAX_ATTEMPTS = 5;

export type PendingRow = { id: string; user_id: string; type: string; ref: string; notice: StoredNotice };

/**
 * The pass's claim on stale pending rows: pending more than ten minutes
 * (a send that died midway, or one deferred by a rate limit), taken in one
 * statement so two passes never take the same row. Rows past the last
 * attempt are given up first.
 */
export async function takeStalePending(limit: number): Promise<{ rows: PendingRow[]; gaveUp: number }> {
  const sql = getSql();
  const gone = (await sql.query(
    `update email_sends set status = 'failed', error = coalesce(error, 'gave_up'), notice = null
      where status = 'pending' and created_at < now() - make_interval(mins => $1::int)
        and (attempts >= $2 or notice is null or user_id is null)
      returning id`,
    [STALE_PENDING_MINUTES, MAX_ATTEMPTS],
  )) as unknown[];
  const rows = (await sql.query(
    `update email_sends set created_at = now(), attempts = attempts + 1
      where id in (
        select id from email_sends
         where status = 'pending' and created_at < now() - make_interval(mins => $1::int)
         order by created_at limit $2
         for update skip locked)
      returning id, user_id, type, ref, notice`,
    [STALE_PENDING_MINUTES, limit],
  )) as PendingRow[];
  return { rows, gaveUp: gone.length };
}
