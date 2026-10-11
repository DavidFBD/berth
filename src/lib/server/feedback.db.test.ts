import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setSqlClient, type SqlClient } from "@/lib/server/db";
import { makeTestDb } from "@/lib/server/pglite-test-db";
import { deliver, setEmailTransport, type DeliverOutcome, type NoticeInput } from "@/lib/server/email/send";
import type { OutgoingEmail } from "@/lib/server/email/resend";
import { alertStaff, FEEDBACK_ALERTS_PER_DAY, listFeedback, markFeedback, submitFeedback } from "./feedback";

/**
 * Staff's side of feedback against the real schema: read and fixed move
 * forward only and are audited in the same statement, and the "it is
 * fixed" email goes once, only to someone who asked for a reply, through
 * the real send decision (email_sends' unique ref).
 */

let sql: SqlClient;
let close: () => Promise<void>;
let sent: OutgoingEmail[];
let staffId: string;
let n = 0;

beforeAll(async () => {
  const db = await makeTestDb();
  sql = db.sql;
  close = db.close;
  setSqlClient(sql);
  const rows = (await sql.query(`insert into users (privy_did) values ('did:privy:staff') returning id`)) as { id: string }[];
  staffId = rows[0].id;
});

afterAll(async () => {
  setEmailTransport(null);
  setSqlClient(null);
  await close();
});

beforeEach(() => {
  sent = [];
  setEmailTransport(async (email) => {
    sent.push(email);
    return { ok: true, id: "re_test" };
  });
});

afterEach(() => setEmailTransport(null));

async function person(email: string | null): Promise<string> {
  n += 1;
  const rows = (await sql.query(`insert into users (privy_did, email) values ($1, $2) returning id`, [`did:privy:fb${n}`, email])) as { id: string }[];
  if (email) {
    await sql.query(
      `insert into user_identities (user_id, kind, value, is_primary, verified_at, proof) values ($1, 'email', $2, true, now(), 'privy_email')`,
      [rows[0].id, email],
    );
  }
  return rows[0].id;
}

const BODY = "The chart on the fund page stayed blank after I switched to a week.";

async function message(userId: string, mayReply: boolean): Promise<string> {
  const result = await submitFeedback(
    { userId, body: BODY, context: { path: "/", viewport: "390x844", userAgent: "test" }, order: null, mayReply },
    new Date(),
  );
  if (!result.ok) throw new Error("not kept");
  return result.id;
}

/** markFeedback's send, run through the real decision and awaited. */
function realSend() {
  const outcomes: Promise<DeliverOutcome>[] = [];
  return { send: (input: NoticeInput) => void outcomes.push(deliver(input)), done: () => Promise.all(outcomes) };
}

describe("markFeedback", () => {
  it("emails a person who asked for a reply once, when their message is first marked fixed", async () => {
    const id = await message(await person(`fixed${n}@example.com`), true);
    const first = realSend();
    expect(await markFeedback({ userId: staffId }, { id, action: "fixed", note: "  Cleared the stale amount  " }, { send: first.send })).toEqual({
      ok: true,
      changed: true,
      emailed: true,
    });
    expect(await first.done()).toEqual(["sent"]);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe("What you told us is fixed");
    expect(sent[0].text).toContain("The chart on the fund page stayed blank after I switched to a week");

    // Marked fixed again: nothing changes and nothing is sent.
    const again = realSend();
    expect(await markFeedback({ userId: staffId }, { id, action: "fixed" }, { send: again.send })).toEqual({ ok: true, changed: false, emailed: false });
    expect(await again.done()).toEqual([]);
    // And even a send asked for again by hand is a duplicate of the one that went.
    expect(await deliver({ userId: (await listFeedback()).find((row) => row.id === id)!.userId, ref: id, notice: { type: "feedback_fixed", excerpt: "x" } })).toBe("duplicate");
    expect(sent).toHaveLength(1);

    const row = (await listFeedback()).find((item) => item.id === id)!;
    expect(row.status).toBe("fixed");
    expect(row.staffNote).toBe("Cleared the stale amount");
    expect(row.replied).toBe(true);
  });

  it("sends nothing when the person did not ask for a reply", async () => {
    const id = await message(await person(`quiet${n}@example.com`), false);
    const run = realSend();
    expect(await markFeedback({ userId: staffId }, { id, action: "fixed" }, { send: run.send })).toEqual({ ok: true, changed: true, emailed: false });
    expect(await run.done()).toEqual([]);
    expect(sent).toHaveLength(0);
  });

  it("never stores a yes to a reply for an account without an email", async () => {
    const id = await message(await person(null), true);
    const row = (await listFeedback()).find((item) => item.id === id)!;
    expect(row.mayReply).toBe(false);
    expect(row.hasEmail).toBe(false);
  });

  it("moves forward only: read after fixed changes nothing, and each change is in the audit log", async () => {
    const id = await message(await person(null), false);
    expect(await markFeedback({ userId: staffId }, { id, action: "read" })).toMatchObject({ ok: true, changed: true });
    expect(await markFeedback({ userId: staffId }, { id, action: "read" })).toMatchObject({ ok: true, changed: false });
    expect(await markFeedback({ userId: staffId }, { id, action: "fixed" })).toMatchObject({ ok: true, changed: true });
    expect(await markFeedback({ userId: staffId }, { id, action: "read" })).toMatchObject({ ok: true, changed: false });
    expect((await listFeedback()).find((row) => row.id === id)!.status).toBe("fixed");
    const audit = (await sql.query(`select action from staff_audit where target = $1 order by id`, [`feedback:${id}`])) as { action: string }[];
    expect(audit.map((row) => row.action)).toEqual(["feedback_read", "feedback_read", "feedback_fixed", "feedback_read"]);
  });

  it("refuses an unknown id or action", async () => {
    expect(await markFeedback({ userId: staffId }, { id: "00000000-0000-4000-8000-000000000000", action: "read" })).toEqual({ ok: false, error: "not_found" });
    expect(await markFeedback({ userId: staffId }, { id: "nope", action: "read" })).toEqual({ ok: false, error: "bad_request" });
    const id = await message(await person(null), false);
    expect(await markFeedback({ userId: staffId }, { id, action: "delete" })).toEqual({ ok: false, error: "bad_request" });
  });
});

describe("listFeedback", () => {
  it("lists newest first with the username where there is one", async () => {
    const id = await person(null);
    await sql.query(`insert into handles (user_id, handle, handle_norm) values ($1, 'harbour_fb', 'harbour_fb')`, [id]);
    const older = await message(id, false);
    await sql.query(`update feedback set created_at = now() - interval '1 day' where id = $1`, [older]);
    const newer = await message(id, false);
    const rows = (await listFeedback()).filter((row) => row.userId === id);
    expect(rows.map((row) => row.id)).toEqual([newer, older]);
    expect(rows[0].username).toBe("harbour_fb");
  });
});

describe("alertStaff", () => {
  it("stops telling staff past the day's cap", async () => {
    const send = vi.fn();
    const admin = await person(null);
    for (let i = 0; i < FEEDBACK_ALERTS_PER_DAY; i += 1) {
      await sql.query(`insert into email_sends (user_id, type, ref, status) values ($1, 'feedback_new', $2, 'sent')`, [admin, `cap-${i}`]);
    }
    expect(await alertStaff("00000000-0000-4000-8000-0000000000ff", BODY, false, { admins: [admin], send })).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});
