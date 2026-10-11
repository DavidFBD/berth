import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setSqlClient, type SqlClient } from "@/lib/server/db";
import { makeTestDb } from "@/lib/server/pglite-test-db";
import { FEEDBACK_MAX_CHARS, FEEDBACK_PER_DAY, FEEDBACK_PER_HOUR } from "@/lib/feedback";
import { XP_ACTIONS } from "@/lib/xp";

/**
 * POST /api/feedback end to end against a real Postgres, with the caller
 * and the mail stubbed: signed in only, the body's limits, the context
 * cleaned whatever the browser sent, the per account rate limit, the one
 * time XP paid once (a double submit and a race included), and staff told
 * of each message without the message waiting on it.
 */

const caller = vi.hoisted(() => ({ wallet: null as string | null }));

vi.mock("@/lib/server/rewards-route", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/rewards-route")>();
  const { NextResponse } = await import("next/server");
  return {
    ...actual,
    readRewardsCaller: vi.fn(async (request: Request) => {
      if (!caller.wallet) return { ok: false, response: NextResponse.json({ error: "wallet session required" }, { status: 401 }) };
      return { ok: true, caller: { did: null, wallet: caller.wallet, body: (await request.json().catch(() => ({}))) as Record<string, unknown> } };
    }),
  };
});

const notices = vi.hoisted(() => ({ sent: [] as { userId: string; ref: string; notice: { type: string } }[] }));
vi.mock("@/lib/server/email/notify", () => ({
  sendNotice: vi.fn((input: { userId: string; ref: string; notice: { type: string } }) => {
    notices.sent.push(input);
  }),
}));

const { POST } = await import("./route");

let sql: SqlClient;
let close: () => Promise<void>;
let n = 0;

const ADMIN = "00000000-0000-4000-8000-0000000000ad";

beforeAll(async () => {
  const db = await makeTestDb();
  sql = db.sql;
  close = db.close;
  setSqlClient(sql);
  vi.stubEnv("STAFF_ADMIN_IDS", ADMIN);
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "abcdef1234567890abcdef1234567890abcdef12");
});

afterAll(async () => {
  vi.unstubAllEnvs();
  setSqlClient(null);
  await close();
});

beforeEach(() => {
  n += 1;
  caller.wallet = `0x${n.toString(16).padStart(40, "0")}`;
  notices.sent = [];
});

function post(body: unknown) {
  return POST(
    new Request("http://localhost:3000/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json", "x-wallet-session": "stubbed" },
      body: JSON.stringify(body),
    }) as never,
  );
}

const LONG = "The sell drawer kept the old amount after I switched stocks.";

async function userId(): Promise<string> {
  const rows = (await sql.query(`select id from users where wallet_address = $1`, [caller.wallet])) as { id: string }[];
  return rows[0].id;
}

async function feedbackEvents(id: string): Promise<number> {
  const rows = (await sql.query(`select count(*)::int as n from xp_events where user_id = $1 and kind = 'feedback_first'`, [id])) as { n: number }[];
  return rows[0].n;
}

describe("POST /api/feedback", () => {
  it("refuses a signed out visitor with 401 and keeps nothing", async () => {
    caller.wallet = null;
    const response = await post({ body: LONG });
    expect(response.status).toBe(401);
    const rows = (await sql.query(`select count(*)::int as n from feedback`)) as { n: number }[];
    expect(rows[0].n).toBe(0);
  });

  it("refuses an empty, a blank or a too long message, and a body that is not an object", async () => {
    expect((await post({ body: "" })).status).toBe(400);
    expect((await post({ body: "   \n  " })).status).toBe(400);
    expect((await post({ body: 42 })).status).toBe(400);
    expect((await post({ body: "x".repeat(FEEDBACK_MAX_CHARS + 1) })).status).toBe(400);
    expect((await post(["a list"])).status).toBe(400);
    expect((await post({ body: "x".repeat(FEEDBACK_MAX_CHARS) })).status).toBe(200);
  });

  it("stores the message with only the cleaned context, never a query string, an amount, an address or an email", async () => {
    const response = await post({
      body: `  ${LONG}  `,
      mayReply: true,
      context: {
        path: "/u/harbourmaster?ref=ABC123&email=sailor@example.com#top",
        viewport: "390x844",
        userAgent: "Mozilla/5.0 (iPhone) sailor@example.com Safari",
        amount: "$1,250.00",
        balance: 999,
        wallet: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
        email: "sailor@example.com",
        name: "Sailor",
      },
      order: { kind: "fill_failed", ref: `0x${"ab".repeat(32)}`, amount: "500", wallet: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed" },
    });
    expect(response.status).toBe(200);
    const data = (await response.json()) as { feedback: { id: string } };
    const rows = (await sql.query(`select body, context, may_reply from feedback where id = $1`, [data.feedback.id])) as {
      body: string;
      context: Record<string, unknown>;
      may_reply: boolean;
    }[];
    expect(rows[0].body).toBe(LONG);
    // No email on this account: there is nobody to reply to, so no yes is kept.
    expect(rows[0].may_reply).toBe(false);
    expect(rows[0].context).toEqual({
      path: "/u/:username",
      viewport: "390x844",
      userAgent: "Mozilla/5.0 (iPhone) Safari",
      build: "abcdef1",
      // No order of this account has that hash: the kind stays, no id, and never the hash.
      order: { kind: "fill_failed", id: null },
    });
    const stored = JSON.stringify(rows[0].context);
    for (const forbidden of ["sailor@example.com", "0x5aAeb", "1,250", "999", "Sailor", "harbourmaster", "ABC123", "abab"]) {
      expect(stored).not.toContain(forbidden);
    }
  });

  it("keeps the order's internal id when the hash is an order of this account, and only then", async () => {
    await post({ body: "first" });
    const id = await userId();
    const hash = `0x${"cd".repeat(32)}`;
    const orders = (await sql.query(
      `insert into orders (user_id, intent_tx, direction, listing_symbol, listing_address) values ($1, $2, 'buy', 'NVDA', $3) returning id`,
      [id, hash, `0x${"1".repeat(40)}`],
    )) as { id: string }[];
    const response = await post({ body: "It said it failed.", order: { kind: "unsettled", ref: hash.toUpperCase().replace("0X", "0x") } });
    const data = (await response.json()) as { feedback: { id: string } };
    const rows = (await sql.query(`select context from feedback where id = $1`, [data.feedback.id])) as { context: { order: unknown } }[];
    expect(rows[0].context.order).toEqual({ kind: "unsettled", id: orders[0].id });

    // Someone else naming that hash learns nothing and links nothing.
    n += 1;
    caller.wallet = `0x${n.toString(16).padStart(40, "0")}`;
    const other = await post({ body: "Not mine.", order: { kind: "error", ref: hash } });
    const otherId = ((await other.json()) as { feedback: { id: string } }).feedback.id;
    const otherRows = (await sql.query(`select context from feedback where id = $1`, [otherId])) as { context: { order: unknown } }[];
    expect(otherRows[0].context.order).toEqual({ kind: "error", id: null });
  });

  it("keeps the yes to a reply only for an account with an email", async () => {
    await post({ body: "first" });
    const id = await userId();
    await sql.query(
      `insert into user_identities (user_id, kind, value, is_primary, verified_at, proof) values ($1, 'email', $2, true, now(), 'privy_email')`,
      [id, `fb${n}@example.com`],
    );
    const yes = (await (await post({ body: "Please reply", mayReply: true })).json()) as { feedback: { id: string } };
    const no = (await (await post({ body: "No reply needed" })).json()) as { feedback: { id: string } };
    const rows = (await sql.query(`select id, may_reply from feedback where id = any($1::uuid[])`, [[yes.feedback.id, no.feedback.id]])) as {
      id: string;
      may_reply: boolean;
    }[];
    expect(Object.fromEntries(rows.map((row) => [row.id, row.may_reply]))).toEqual({ [yes.feedback.id]: true, [no.feedback.id]: false });
  });

  it(`answers 429 past ${FEEDBACK_PER_HOUR} an hour, and counts per account`, async () => {
    for (let i = 0; i < FEEDBACK_PER_HOUR; i += 1) expect((await post({ body: `message ${i}` })).status).toBe(200);
    const refused = await post({ body: "one more" });
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("3600");
    const id = await userId();
    const rows = (await sql.query(`select count(*)::int as n from feedback where user_id = $1`, [id])) as { n: number }[];
    expect(rows[0].n).toBe(FEEDBACK_PER_HOUR);

    n += 1;
    caller.wallet = `0x${n.toString(16).padStart(40, "0")}`;
    expect((await post({ body: "someone else" })).status).toBe(200);
  });

  it(`answers 429 past ${FEEDBACK_PER_DAY} a day, whatever the hour`, async () => {
    await post({ body: "first" });
    const id = await userId();
    // Spread through the day, none in the last hour.
    for (let i = 0; i < FEEDBACK_PER_DAY - 1; i += 1) {
      await sql.query(`insert into feedback (user_id, body, created_at) values ($1, 'older', now() - interval '2 hours' - ($2::int * interval '30 minutes'))`, [id, i]);
    }
    expect((await post({ body: "the twenty first" })).status).toBe(429);
  });

  it("pays feedback_first once, for the first message of at least twenty characters", async () => {
    const short = (await (await post({ body: "Nice app" })).json()) as { feedback: { awarded: number }; rewards: unknown[] };
    expect(short.feedback.awarded).toBe(0);
    expect(short.rewards).toEqual([]);
    const id = await userId();
    expect(await feedbackEvents(id)).toBe(0);

    const first = (await (await post({ body: LONG })).json()) as { feedback: { awarded: number }; rewards: unknown[]; xp: number };
    expect(first.feedback.awarded).toBe(XP_ACTIONS.feedback_first.amount);
    expect(first.rewards).toContainEqual({ kind: "feedback_first", amount: XP_ACTIONS.feedback_first.amount });

    const second = (await (await post({ body: `${LONG} Again.` })).json()) as { feedback: { awarded: number }; xp: number };
    expect(second.feedback.awarded).toBe(0);
    expect(second.xp).toBe(first.xp);
    expect(await feedbackEvents(id)).toBe(1);
  });

  it("pays it once when the same message is sent several times at once", async () => {
    await post({ body: "hello" });
    const id = await userId();
    const answers = await Promise.all([post({ body: LONG }), post({ body: LONG }), post({ body: LONG }), post({ body: LONG })]);
    const awarded = await Promise.all(answers.map(async (response) => ((await response.json()) as { feedback: { awarded: number } }).feedback.awarded));
    expect(awarded.filter((amount) => amount > 0)).toEqual([XP_ACTIONS.feedback_first.amount]);
    expect(await feedbackEvents(id)).toBe(1);
    const xp = (await sql.query(`select xp from users where id = $1`, [id])) as { xp: number }[];
    const ledger = (await sql.query(`select coalesce(sum(amount), 0)::int as total from xp_events where user_id = $1`, [id])) as { total: number }[];
    expect(xp[0].xp).toBe(ledger[0].total);
  });

  it("tells every staff admin of each message, with its first words and never who sent it", async () => {
    const response = await post({ body: LONG });
    const id = ((await response.json()) as { feedback: { id: string } }).feedback.id;
    expect(notices.sent).toEqual([{ userId: ADMIN, ref: `${id}:${ADMIN}`, notice: { type: "feedback_new", excerpt: LONG, fromOrder: false } }]);
  });

  it("saves the message even when telling staff fails", async () => {
    const { sendNotice } = await import("@/lib/server/email/notify");
    vi.mocked(sendNotice).mockImplementationOnce(() => {
      throw new Error("mail down");
    });
    const response = await post({ body: LONG });
    expect(response.status).toBe(200);
    const id = ((await response.json()) as { feedback: { id: string } }).feedback.id;
    const rows = (await sql.query(`select 1 from feedback where id = $1`, [id])) as unknown[];
    expect(rows).toHaveLength(1);
  });
});
