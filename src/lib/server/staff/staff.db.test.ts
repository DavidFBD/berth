import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setSqlClient, type SqlClient } from "@/lib/server/db";
import { makeTestDb } from "@/lib/server/pglite-test-db";
import { setEmailTransport, setBackoff } from "@/lib/server/email/send";
import { mintStaffCookie, staffCookieName, staffSessionKey, STAFF_FRESH_MS } from "@/lib/server/staff-session";
import { createStaffSession } from "@/lib/server/staff-sessions";
import { holdsPersonal } from "@/lib/staff/mask";
import { POST as reveal } from "@/app/api/staff/reveal/route";
import { POST as act } from "@/app/api/staff/actions/route";
import { classifySearch, listUsers, userDetail } from "./users";
import { readBudgets, runBudgetAlerts } from "./budgets";
import { listAudit } from "./audit-log";
import { readHealth } from "./health";
import { recordCronRun } from "@/lib/server/cron-runs";
import { recordSpend } from "@/lib/server/spend-meter";

/**
 * The staff area against the real schema (PGlite): the users list and its
 * search, masking on every row, the reveal and the writes through their
 * routes (gate, freshness, audit rows), budgets and the once a day alert,
 * and that nothing personal reaches a log line.
 */

let sql: SqlClient;
let close: () => Promise<void>;
const SECRET = "k".repeat(48);
const ORIGIN = "http://localhost:3220";

let n = 0;
async function account({ email, wallet, handle, createdAt }: { email?: string; wallet?: string; handle?: string; createdAt?: string } = {}) {
  n += 1;
  const rows = (await sql.query(`insert into users (privy_did, email, wallet_address, created_at) values ($1, $2, $3, coalesce($4::timestamptz, now())) returning id`, [
    `did:privy:s${n}`,
    email ?? null,
    wallet ?? null,
    createdAt ?? null,
  ])) as { id: string }[];
  const id = rows[0].id;
  if (email) await sql.query(`insert into user_identities (user_id, kind, value, is_primary, proof) values ($1, 'email', $2, true, 'privy_email')`, [id, email]);
  if (wallet) await sql.query(`insert into user_identities (user_id, kind, value, family, is_home, proof) values ($1, 'wallet', $2, 'evm', true, 'privy_wallet')`, [id, `eip155:${wallet}`]);
  if (handle) {
    await sql.query(`insert into handles (user_id, handle, handle_norm) values ($1, $2, $3)`, [id, handle, handle.toLowerCase()]);
    await sql.query(`insert into profiles (user_id) values ($1)`, [id]);
  }
  return id;
}


/** A route's status, counting Next's notFound() (the unknown address 404) as 404. */
async function statusOf(call: Promise<Response> | (() => Promise<Response>)): Promise<number> {
  try {
    return (await (typeof call === "function" ? call() : call)).status;
  } catch (error) {
    const tag = `${(error as { digest?: string }).digest ?? ""} ${(error as Error).message ?? ""}`;
    if (/404|NEXT_NOT_FOUND/.test(tag)) return 404;
    throw error;
  }
}

const WALLET = "0x1234567890abcdef1234567890abcdef123456ab";
let admin: string, viewer: string, person: string, other: string;

async function cookie(userId: string, authAt: number | null = Date.now()) {
  const session = await createStaffSession(userId, authAt, Date.now() + 3_600_000);
  return `${staffCookieName()}=${await mintStaffCookie({ sessionId: session.id, expiresAt: session.expiresAt }, staffSessionKey()!)}`;
}
function post(path: string, body: unknown, cookieHeader: string | null, origin = ORIGIN) {
  const headers: Record<string, string> = { host: "localhost:3220", "content-type": "application/json", origin };
  if (cookieHeader) headers.cookie = cookieHeader;
  return new Request(`${ORIGIN}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}

const logged: string[] = [];

beforeAll(async () => {
  const db = await makeTestDb();
  sql = db.sql;
  close = db.close;
  setSqlClient(sql);
  admin = await account({ email: "admin@sodax.com", handle: "harbourmaster" });
  viewer = await account({ email: "viewer@sodax.com" });
  person = await account({ email: "sailor@example.com", wallet: WALLET, handle: "sailor" });
  other = await account({ handle: "salt", createdAt: new Date(Date.now() - 40 * 86_400_000).toISOString() });
  for (let i = 0; i < 4; i += 1) await account();
});

beforeEach(() => {
  vi.stubEnv("STAFF_SESSION_SECRET", SECRET);
  vi.stubEnv("STAFF_ADMIN_IDS", admin);
  vi.stubEnv("STAFF_VIEWER_IDS", viewer);
  logged.length = 0;
  for (const level of ["log", "info", "warn", "error"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  // Nothing the staff area does may put an email or a wallet into a log line.
  for (const line of logged) expect(holdsPersonal(line), line).toBe(false);
});

afterAll(async () => {
  setEmailTransport(null);
  setSqlClient(null);
  await close();
});

describe("the users list", () => {
  it("classifies a search by its shape", () => {
    expect(classifySearch("")).toEqual({ kind: "none" });
    expect(classifySearch(" Sailor@Example.com ")).toEqual({ kind: "email", value: "sailor@example.com" });
    expect(classifySearch("sail@")).toEqual({ kind: "invalid" });
    expect(classifySearch(WALLET.toUpperCase().replace("0X", "0x"))).toMatchObject({ kind: "wallet", column: WALLET });
    expect(classifySearch("@sail")).toEqual({ kind: "username", fold: "sail" });
    expect(classifySearch("drop table;")).toEqual({ kind: "invalid" });
  });

  it("masks every email and wallet it returns", async () => {
    const page = await listUsers();
    const row = page.rows.find((r) => r.id === person)!;
    expect(row).toMatchObject({ handle: "sailor", email: "s***@example.com", wallet: "0x12…ab" });
    expect(holdsPersonal(JSON.stringify(page))).toBe(false);
  });

  it("finds by exact email or wallet only, and by username prefix", async () => {
    expect((await listUsers({ q: "sailor@example.com" })).rows.map((r) => r.id)).toEqual([person]);
    expect((await listUsers({ q: "sailor@example" })).rows).toEqual([]);
    expect((await listUsers({ q: WALLET })).rows.map((r) => r.id)).toEqual([person]);
    expect((await listUsers({ q: WALLET.slice(0, 30) })).rows).toEqual([]);
    expect((await listUsers({ q: "sal" })).rows.map((r) => r.id)).toEqual([other]);
    expect((await listUsers({ q: "sa" })).rows.map((r) => r.id).sort()).toEqual([person, other].sort());
  });

  it("paginates and filters", async () => {
    const first = await listUsers({ pageSize: 3 });
    expect(first).toMatchObject({ total: 8, pages: 3, page: 1 });
    const third = await listUsers({ pageSize: 3, page: 3 });
    expect(third.rows).toHaveLength(2);
    const seen = new Set([...first.rows, ...(await listUsers({ pageSize: 3, page: 2 })).rows, ...third.rows].map((r) => r.id));
    expect(seen.size).toBe(8);
    expect(await listUsers({ pageSize: 3, page: 9 })).toMatchObject({ rows: [], total: 8 });
    expect((await listUsers({ hasEmail: true })).total).toBe(3);
    const since = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
    expect((await listUsers({ from: since })).rows.map((r) => r.id)).not.toContain(other);
    expect((await listUsers({ stage: "owns" })).total).toBe(0);
  });

  it("shows a person's page masked", async () => {
    const detail = (await userDetail(person))!;
    expect(detail.identities.map((i) => i.masked).sort()).toEqual(["0x12…ab", "s***@example.com"]);
    expect(detail.email.primary).toBe("s***@example.com");
    expect(holdsPersonal(JSON.stringify(detail))).toBe(false);
    expect(await userDetail("00000000-0000-4000-8000-000000000000")).toBeNull();
  });
});

describe("the reveal", () => {
  it("is 404 to strangers and to no cookie, 403 to a viewer, 401 when stale", async () => {
    const identity = (await userDetail(person))!.identities.find((i) => i.kind === "email")!.id!;
    const body = { userId: person, identityId: identity, reason: "support ticket 12" };
    expect(await statusOf(reveal(post("/api/staff/reveal", body, null)))).toBe(404);
    expect(await statusOf(reveal(post("/api/staff/reveal", body, await cookie(person))))).toBe(404);
    expect(await statusOf(reveal(post("/api/staff/reveal", body, await cookie(viewer))))).toBe(403);
    expect(await statusOf(reveal(post("/api/staff/reveal", body, await cookie(admin, Date.now() - STAFF_FRESH_MS - 1000))))).toBe(401);
    expect(await statusOf(reveal(post("/api/staff/reveal", body, await cookie(admin), "https://elsewhere.example")))).toBe(404);
    const audit = await listAudit({ action: "reveal_email" });
    expect(audit.total).toBe(0);
  });

  it("shows the value to a fresh admin with a reason, after the audit row", async () => {
    const identity = (await userDetail(person))!.identities.find((i) => i.kind === "email")!.id!;
    expect(await statusOf(reveal(post("/api/staff/reveal", { userId: person, identityId: identity, reason: "x" }, await cookie(admin))))).toBe(400);
    const response = await reveal(post("/api/staff/reveal", { userId: person, identityId: identity, reason: "support ticket 12" }, await cookie(admin)));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ value: "sailor@example.com" });
    const audit = await listAudit({ action: "reveal_email" });
    expect(audit.rows[0]).toMatchObject({ staffId: admin, staffHandle: "harbourmaster", target: `user:${person}`, detail: { reason: "support ticket 12" } });
    const wallet = await reveal(post("/api/staff/reveal", { userId: person, column: "wallet", reason: "abuse report about 0x1234567890abcdef1234567890abcdef123456ab" }, await cookie(admin)));
    expect(await wallet.json()).toEqual({ value: WALLET });
    // The reason that pasted the address keeps only its mask.
    expect((await listAudit({ action: "reveal_wallet" })).rows[0].detail).toMatchObject({ reason: "abuse report about 0x12…ab" });
  });
});

describe("the writes", () => {
  it("are refused to a viewer and to a stale admin, and write nothing", async () => {
    const before = (await listAudit()).total;
    expect(await statusOf(act(post("/api/staff/actions", { action: "hide", userId: person, reason: "impersonation" }, await cookie(viewer))))).toBe(403);
    expect(await statusOf(act(post("/api/staff/actions", { action: "hide", userId: person, reason: "impersonation" }, await cookie(admin, null))))).toBe(401);
    expect(await statusOf(act(post("/api/staff/actions", { action: "hide", userId: person, reason: "impersonation" }, null)))).toBe(404);
    expect((await listAudit()).total).toBe(before);
    expect((await userDetail(person))!.profile).toEqual({ visible: true, hiddenAt: null, byStaff: false });
  });

  it("hide and show a profile, audited, and only show what staff hid", async () => {
    const res = await act(post("/api/staff/actions", { action: "hide", userId: person, reason: "impersonation report" }, await cookie(admin)));
    expect(await res.json()).toEqual({ ok: true, changed: true });
    expect((await userDetail(person))!.profile).toMatchObject({ visible: false, byStaff: true });
    const again = await act(post("/api/staff/actions", { action: "hide", userId: person, reason: "impersonation report" }, await cookie(admin)));
    expect(await again.json()).toEqual({ ok: true, changed: false });
    // The person's own switch cannot show a card staff hid.
    const { setVisible } = await import("@/lib/server/social/handles");
    await setVisible({ id: person, email: "sailor@example.com" }, true);
    expect((await userDetail(person))!.profile?.visible).toBe(false);
    await act(post("/api/staff/actions", { action: "unhide", userId: person, reason: "resolved" }, await cookie(admin)));
    expect((await userDetail(person))!.profile).toMatchObject({ visible: true, byStaff: false });
    expect((await listAudit({ action: "profile_hide" })).total).toBe(2);
    expect((await listAudit({ target: `user:${person}` })).total).toBeGreaterThanOrEqual(3);
  });

  it("never shows a card the person hid themselves", async () => {
    const { setVisible } = await import("@/lib/server/social/handles");
    await setVisible({ id: person, email: "sailor@example.com" }, false);
    const res = await act(post("/api/staff/actions", { action: "unhide", userId: person, reason: "asked by someone" }, await cookie(admin)));
    expect(await res.json()).toEqual({ ok: true, changed: false });
    expect((await userDetail(person))!.profile).toMatchObject({ visible: false, byStaff: false });
    await setVisible({ id: person, email: "sailor@example.com" }, true);
  });

  it("suppress and allow email again, but never lift a bounce or a complaint", async () => {
    await act(post("/api/staff/actions", { action: "suppress", userId: person, reason: "asked to stop" }, await cookie(admin)));
    expect((await userDetail(person))!.email.suppressed).toMatchObject({ reason: "staff", removable: true });
    await act(post("/api/staff/actions", { action: "unsuppress", userId: person, reason: "asked to resume" }, await cookie(admin)));
    expect((await userDetail(person))!.email.suppressed).toBeNull();
    await sql.query(`insert into email_suppressions (address, reason) values ('sailor@example.com', 'complaint')`);
    const lift = await act(post("/api/staff/actions", { action: "unsuppress", userId: person, reason: "asked to resume" }, await cookie(admin)));
    expect(await lift.json()).toEqual({ ok: true, changed: false });
    expect((await userDetail(person))!.email.suppressed).toMatchObject({ reason: "complaint", removable: false });
    await sql.query(`delete from email_suppressions`);
    expect((await act(post("/api/staff/actions", { action: "suppress", userId: other, reason: "no email" }, await cookie(admin)))).status).toBe(404);
  });

  it("suppresses an older account's users.email when no identity row has it", async () => {
    const legacy = ((await sql.query(`insert into users (privy_did, email) values ('did:privy:legacy', 'Old.Hand@Example.com') returning id`)) as { id: string }[])[0].id;
    await act(post("/api/staff/actions", { action: "suppress", userId: legacy, reason: "asked to stop" }, await cookie(admin)));
    expect((await userDetail(legacy))!.email).toMatchObject({ primary: "o***@example.com", suppressed: { reason: "staff" } });
    await sql.query(`delete from email_suppressions`);
  });

  it("revokes an AI connection", async () => {
    const grant = ((await sql.query(`insert into oauth_grants (user_id, client_id, client_name, scope) values ($1, 'c', 'Claude', 'berth.read') returning id`, [person])) as { id: string }[])[0].id;
    expect(await statusOf(act(post("/api/staff/actions", { action: "revoke", userId: other, grantId: grant, reason: "abuse" }, await cookie(admin))))).toBe(404);
    const res = await act(post("/api/staff/actions", { action: "revoke", userId: person, grantId: grant, reason: "asked by the person" }, await cookie(admin)));
    expect(await res.json()).toEqual({ ok: true, changed: true });
    expect((await userDetail(person))!.assistants.grants[0].revokedAt).not.toBeNull();
  });

  it("marks an account ineligible for campaigns in the column campaigns read", async () => {
    await act(post("/api/staff/actions", { action: "ineligible", userId: other, reason: "duplicate person" }, await cookie(admin)));
    const rows = (await sql.query(`select campaign_ineligible_at, campaign_ineligible_by from users where id = $1`, [other])) as { campaign_ineligible_at: unknown; campaign_ineligible_by: string }[];
    expect(rows[0].campaign_ineligible_at).not.toBeNull();
    expect(rows[0].campaign_ineligible_by).toBe(admin);
    expect((await listUsers({ ineligible: true })).rows.map((r) => r.id)).toEqual([other]);
    await act(post("/api/staff/actions", { action: "eligible", userId: other, reason: "cleared" }, await cookie(admin)));
    expect((await listUsers({ ineligible: true })).total).toBe(0);
  });

  it("sends a stuck notice again, and leaves a fresh one alone", async () => {
    const sent: string[] = [];
    setEmailTransport(async (email) => {
      sent.push(email.subject);
      return { ok: true, id: "re_1" };
    });
    const stuck = ((await sql.query(
      `insert into email_sends (user_id, type, ref, status, notice, created_at) values ($1, 'accounts_merged', 'm1', 'pending', '{"type":"accounts_merged"}', now() - interval '1 hour') returning id`,
      [person],
    )) as { id: string }[])[0].id;
    const fresh = ((await sql.query(
      `insert into email_sends (user_id, type, ref, status, notice) values ($1, 'accounts_merged', 'm2', 'pending', '{"type":"accounts_merged"}') returning id`,
      [person],
    )) as { id: string }[])[0].id;
    const health = await readHealth();
    expect(health.email.stuck.map((row) => row.id)).toEqual([stuck]);
    expect(await (await act(post("/api/staff/actions", { action: "retry", sendId: fresh, reason: "stuck in queue" }, await cookie(admin)))).json()).toEqual({ ok: true, changed: false, outcome: "not_stuck" });
    expect(await (await act(post("/api/staff/actions", { action: "retry", sendId: stuck, reason: "stuck in queue" }, await cookie(admin)))).json()).toEqual({ ok: true, changed: true, outcome: "sent" });
    expect(sent).toHaveLength(1);
    expect((await listAudit({ action: "email_retry_outcome" })).rows[0].detail).toEqual({ outcome: "sent" });
    setEmailTransport(null);
  });
});

describe("health", () => {
  it("reads cron runs back with their stages", async () => {
    await recordCronRun("morning", new Date(), false, { holds: { ok: false, error: "rpc down" }, failed: true, note: "from a@b.co" });
    const health = await readHealth();
    expect(health.morning[0]).toMatchObject({ ok: false, summary: { holds: { ok: false, error: "rpc down" }, note: "from a***@b****.co" } });
    expect(health.evening).toEqual([]);
    expect(health.issues).toEqual({ state: "off" });
  });
});

describe("budgets", () => {
  it("adds up each service's spend and what is left", async () => {
    await sql.query(`insert into chat_usage (user_id, provider, model, steps, input_tokens, output_tokens, cost_micros, ok, duration_ms) values ($1, 'openai', 'm', 1, 1, 1, 1500000, true, 1)`, [person]);
    await recordSpend("jev", { units: 1000, costMicros: 42 });
    await recordSpend("jev", { units: 1000, costMicros: 42 });
    await sql.query(`insert into x_read_budget (day, used) values (to_char(now() at time zone 'UTC', 'YYYY-MM-DD'), 40)`);
    vi.stubEnv("CHAT_MONTHLY_BUDGET_USD", "5");
    const budgets = await readBudgets();
    const openai = budgets.find((b) => b.id === "openai")!;
    expect(openai.meters[0]).toMatchObject({ id: "budget", today: 1.5, month: 1.5, remaining: 3.5, low: false });
    const jev = budgets.find((b) => b.id === "jev")!;
    expect(jev.meters[0]).toMatchObject({ id: "credit", remaining: null, low: false });
    expect(jev.meters[0].today).toBeCloseTo(0.000084);
    const x = budgets.find((b) => b.id === "x")!;
    expect(x.meters[0].today).toBeCloseTo(0.2);
    expect(x.meters[1]).toMatchObject({ id: "cap", today: 40, remaining: 10, low: false });
    expect(budgets.find((b) => b.id === "neon")).toMatchObject({ tracked: false });
  });

  it("emails each admin once a day about a service running low", async () => {
    await act(post("/api/staff/actions", { action: "budget", service: "jev", balanceUsd: "0.50", threshold: "1", reason: "read off TypeSafe" }, await cookie(admin)));
    const jev = (await readBudgets()).find((b) => b.id === "jev")!;
    expect(jev.settings).toMatchObject({ balanceUsd: 0.5, threshold: 1 });
    expect(jev.meters[0]).toMatchObject({ low: true, why: "threshold" });
    expect((await listAudit({ action: "budget_set" })).rows[0].detail).toMatchObject({ balanceUsd: 0.5, threshold: 1 });

    const sent: { to: string; subject: string }[] = [];
    setBackoff([]);
    setEmailTransport(async (email) => {
      sent.push({ to: email.to, subject: email.subject });
      return { ok: true, id: "re_2" };
    });
    vi.stubEnv("EMAIL_DAILY_CAP", "0"); // a security notice passes even a full day
    const first = await runBudgetAlerts();
    expect(first).toMatchObject({ low: 1, sent: 1 });
    expect(sent).toEqual([{ to: "admin@sodax.com", subject: "Running low: the news model credit" }]);
    const second = await runBudgetAlerts();
    expect(second).toMatchObject({ low: 1, sent: 0, already: 1 });
    expect(sent).toHaveLength(1);
    const tomorrow = await runBudgetAlerts({ now: new Date(Date.now() + 86_400_000) });
    expect(tomorrow.sent).toBe(1);
    setEmailTransport(null);
    setBackoff(null);
  });

  it("refuses a budget write with a bad amount or service", async () => {
    expect(await statusOf(act(post("/api/staff/actions", { action: "budget", service: "jev", balanceUsd: "-3", reason: "typo here" }, await cookie(admin))))).toBe(400);
    expect(await statusOf(act(post("/api/staff/actions", { action: "budget", service: "neon", balanceUsd: "3", reason: "typo here" }, await cookie(admin))))).toBe(400);
  });
});
