import { getSql, inTransaction } from "@/lib/server/db";
import { awardXp } from "@/lib/server/accounts";
import { primaryEmail, sendsToday } from "@/lib/server/email/store";
import { sendNotice } from "@/lib/server/email/notify";
import { staffAdminIds, auditCte, type StaffContext } from "@/lib/server/staff-gate";
import {
  FEEDBACK_PER_DAY,
  FEEDBACK_PER_HOUR,
  excerpt,
  qualifiesForXp,
  type FeedbackContext,
  type FeedbackOrder,
} from "@/lib/feedback";
import { XP_ACTIONS } from "@/lib/xp";

/**
 * Feedback, server side (db: feedback). A person's message is kept with the
 * context lib/feedback sanitizeContext let through, the first qualifying
 * one pays feedback_first once, and every staff admin hears of it by email
 * (fail soft: the message is saved whatever the mail does). Staff mark it
 * read or fixed on /staff/feedback; fixed, with the person's yes to a
 * reply and an email on the account, sends them one short email, once.
 */

/**
 * Staff emails about new messages, at most this many a UTC day across all
 * admins, so a busy day never spends the house's email quota on alerts;
 * the staff page lists every message either way.
 */
export const FEEDBACK_ALERTS_PER_DAY = 10;

export type SubmitInput = {
  userId: string;
  body: string;
  context: FeedbackContext;
  order: FeedbackOrder | null;
  mayReply: boolean;
};

export type SubmitResult = { ok: true; id: string; awarded: number; xp: number | null } | { ok: false; error: "too_many" };

/** The deployed commit, short, when Vercel says it. */
export function buildSha(env: NodeJS.ProcessEnv = process.env): string | null {
  const sha = env.VERCEL_GIT_COMMIT_SHA ?? env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? "";
  return /^[0-9a-f]{7,40}$/i.test(sha) ? sha.slice(0, 7).toLowerCase() : null;
}

/** The order's internal id, only when that hub transaction is an order of this account. */
async function orderIdFor(userId: string, ref: string | null | undefined): Promise<string | null> {
  if (!ref) return null;
  const rows = (await getSql().query(`select id from orders where lower(intent_tx) = $1 and user_id = $2 limit 1`, [
    ref.toLowerCase(),
    userId,
  ])) as { id: string }[];
  return rows[0]?.id ?? null;
}

/**
 * Keep one message. The rate limit is counted from the account's own rows
 * in the same statement as the insert, so a burst cannot slip past it
 * between a count and a write. `may_reply` is kept only for an account with
 * an email to reply to.
 */
export async function submitFeedback(input: SubmitInput, now = new Date()): Promise<SubmitResult> {
  const [address, orderId] = await Promise.all([
    input.mayReply ? primaryEmail(input.userId) : Promise.resolve(null),
    input.order ? orderIdFor(input.userId, input.order.ref) : Promise.resolve(null),
  ]);
  const context: FeedbackContext = {
    path: input.context.path,
    viewport: input.context.viewport,
    userAgent: input.context.userAgent,
    build: buildSha(),
    ...(input.order ? { order: { kind: input.order.kind, id: orderId } } : {}),
  };
  // One account's inserts take turns (a transaction scoped advisory lock),
  // so two tabs racing cannot both read four and both write.
  const [, rows] = (await inTransaction([
    { text: `select pg_advisory_xact_lock(hashtextextended('feedback:' || $1::text, 0))`, params: [input.userId] },
    {
      text: `insert into feedback (user_id, body, context, may_reply, created_at)
             select $1, $2, $3::jsonb, $4, $5::timestamptz
              where (select count(*) from feedback where user_id = $1 and created_at > $5::timestamptz - interval '1 hour') < $6
                and (select count(*) from feedback where user_id = $1 and created_at > $5::timestamptz - interval '1 day') < $7
             returning id`,
      params: [input.userId, input.body, JSON.stringify(context), Boolean(address), now.toISOString(), FEEDBACK_PER_HOUR, FEEDBACK_PER_DAY],
    },
  ], { isolationLevel: "ReadCommitted" })) as [unknown[], { id: string }[]];
  const id = rows[0]?.id;
  if (!id) return { ok: false, error: "too_many" };

  let awarded = 0;
  let xp: number | null = null;
  if (qualifiesForXp(input.body)) {
    // Once per account by the ledger's own index (xp_events_once_per_user):
    // a second message, a double tap and two requests racing pay nothing.
    try {
      const paid = await awardXp(input.userId, "feedback_first", null);
      awarded = paid.awarded;
      xp = paid.xp;
    } catch (error) {
      console.warn("[feedback] xp not awarded:", error instanceof Error ? error.name : "error");
    }
  }

  await alertStaff(id, input.body, Boolean(input.order));
  return { ok: true, id, awarded, xp };
}

/**
 * Every staff admin is told by email, after the response, never twice for
 * one message (email_sends' unique ref). Never throws: the message is
 * already saved.
 */
export async function alertStaff(
  feedbackId: string,
  body: string,
  fromOrder: boolean,
  { admins = staffAdminIds(), send = sendNotice }: { admins?: readonly string[]; send?: typeof sendNotice } = {},
): Promise<number> {
  if (admins.length === 0) return 0;
  try {
    if ((await sendsToday("feedback_new")) >= FEEDBACK_ALERTS_PER_DAY) return 0;
    for (const admin of admins) {
      send({ userId: admin, ref: `${feedbackId}:${admin}`, notice: { type: "feedback_new", excerpt: excerpt(body, 280), fromOrder } });
    }
    return admins.length;
  } catch (error) {
    console.warn("[feedback] staff not told:", error instanceof Error ? error.name : "error");
    return 0;
  }
}

/** One message as the staff page lists it. */
export type FeedbackRow = {
  id: string;
  userId: string;
  username: string | null;
  body: string;
  context: FeedbackContext;
  mayReply: boolean;
  /** Whether the account has an email a reply could reach now. */
  hasEmail: boolean;
  status: "new" | "read" | "fixed";
  createdAt: string;
  fixedAt: string | null;
  staffNote: string | null;
  /** Whether the "it is fixed" email has gone (or is on its way). */
  replied: boolean;
};

/** Newest first, with the username where there is one. */
export async function listFeedback({ limit = 100, status }: { limit?: number; status?: FeedbackRow["status"] } = {}): Promise<FeedbackRow[]> {
  const rows = (await getSql().query(
    `select f.id, f.user_id, h.handle, f.body, f.context, f.may_reply, f.status, f.created_at, f.fixed_at, f.staff_note,
            exists (select 1 from user_identities i where i.user_id = f.user_id and i.kind = 'email' and i.is_primary)
              or exists (select 1 from users u where u.id = f.user_id and u.email is not null) as has_email,
            exists (select 1 from email_sends s where s.type = 'feedback_fixed' and s.ref = f.id::text and s.status in ('pending', 'sent')) as replied
       from feedback f
       left join handles h on h.user_id = f.user_id
      where ($2::text is null or f.status = $2)
      order by f.created_at desc
      limit $1`,
    [Math.max(1, Math.min(500, limit)), status ?? null],
  )) as {
    id: string;
    user_id: string;
    handle: string | null;
    body: string;
    context: FeedbackContext;
    may_reply: boolean;
    status: FeedbackRow["status"];
    created_at: string | Date;
    fixed_at: string | Date | null;
    staff_note: string | null;
    has_email: boolean;
    replied: boolean;
  }[];
  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    username: row.handle,
    body: row.body,
    context: row.context ?? { path: null, viewport: null, userAgent: null },
    mayReply: row.may_reply,
    hasEmail: row.has_email,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    fixedAt: row.fixed_at ? new Date(row.fixed_at).toISOString() : null,
    staffNote: row.staff_note,
    replied: row.replied,
  }));
}

/** How many messages nobody has read yet, for the Overview's strip. */
export async function unreadFeedbackCount(): Promise<number> {
  const rows = (await getSql().query(`select count(*)::int as n from feedback where status = 'new'`)) as { n: number }[];
  return rows[0]?.n ?? 0;
}

export const STAFF_NOTE_MAX = 300;

/** A staff note as typed: one line, at most three hundred characters, or null. */
export function cleanStaffNote(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const flat = raw.replace(/\s+/g, " ").trim();
  return flat ? flat.slice(0, STAFF_NOTE_MAX) : null;
}

export type MarkResult =
  | { ok: true; changed: boolean; emailed: boolean }
  | { ok: false; error: "not_found" | "bad_request" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Mark a message read, or fixed with an optional note. Forward only: new to
 * read, new or read to fixed; marking it again changes nothing. The change
 * and its staff_audit row are one statement. The first time a message
 * becomes fixed, and only then, a person who said yes to a reply and has an
 * email gets one short email; email_sends' unique (type, ref) keeps it to
 * one whatever happens after.
 */
export async function markFeedback(
  staff: Pick<StaffContext, "userId">,
  input: { id: unknown; action: unknown; note?: unknown },
  { send = sendNotice }: { send?: typeof sendNotice } = {},
): Promise<MarkResult> {
  const id = typeof input.id === "string" && UUID.test(input.id) ? input.id.toLowerCase() : null;
  const action = input.action === "read" || input.action === "fixed" ? input.action : null;
  if (!id || !action) return { ok: false, error: "bad_request" };
  const note = action === "fixed" ? cleanStaffNote(input.note) : null;
  const sql = getSql();
  const exists = (await sql.query(`select 1 from feedback where id = $1`, [id])) as unknown[];
  if (exists.length === 0) return { ok: false, error: "not_found" };
  // The note is a parameter only when there is a place for it: an unused one has no type.
  const params: unknown[] = action === "read" ? [id] : [id, note];
  const audit = auditCte(params, staff.userId, action === "read" ? "feedback_read" : "feedback_fixed", `feedback:${id}`, note ? { note } : {});
  const update =
    action === "read"
      ? `update feedback set status = 'read', read_at = now()
          where id = $1 and status = 'new' and exists (select 1 from audit)
          returning user_id, may_reply, body`
      : `update feedback set status = 'fixed', fixed_at = now(), read_at = coalesce(read_at, now()),
                staff_note = coalesce($2::text, staff_note)
          where id = $1 and status <> 'fixed' and exists (select 1 from audit)
          returning user_id, may_reply, body`;
  const rows = (await sql.query(
    `with audit as (${audit}),
          changed as (${update})
     select c.user_id, c.may_reply, c.body
       from audit left join changed c on true`,
    params,
  )) as { user_id: string | null; may_reply: boolean | null; body: string | null }[];
  const row = rows[0];
  const changed = Boolean(row?.user_id);
  let emailed = false;
  if (row && changed && action === "fixed" && row.may_reply && row.body) {
    // deliver() reads the verified primary email at send time; an account
    // without one is skipped there ("no_address"), never guessed.
    send({ userId: row.user_id!, ref: id, notice: { type: "feedback_fixed", excerpt: excerpt(row.body, 140) } });
    emailed = true;
  }
  return { ok: true, changed, emailed };
}

/** The amount the first qualifying message earns, for the sheet's words. */
export const FEEDBACK_XP = XP_ACTIONS.feedback_first.amount;
