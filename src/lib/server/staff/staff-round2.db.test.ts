import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setSqlClient, type SqlClient } from "@/lib/server/db";
import { makeTestDb } from "@/lib/server/pglite-test-db";

/**
 * The staff area's second round against the real schema (PGlite):
 * sessions in staff_sessions (renewal, sign out everywhere, expiry), the
 * session door refusing an account with no email, the reveal ceiling and
 * its alert, sealed searches bound to one staff member, last_seen_at, the
 * budget edges, and the audit prune on its own.
 */

const verify = vi.fn();
const verifiedAt = vi.fn();
vi.mock("@/lib/server/privy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/privy")>()),
  verifyPrivyToken: (...args: unknown[]) => verify(...args),
  emailProofAt: (...args: unknown[]) => verifiedAt(...args),
}));

import { createStaffSession, readLiveSession, renewStaffSession, revokeAllStaffSessions } from "@/lib/server/staff-sessions";
import { mintStaffCookie, openSearch, sealSearch, staffCookieName, staffSessionKey } from "@/lib/server/staff-session";
import { staffFromCookie } from "@/lib/server/staff-gate";
import { POST as door, DELETE as leave } from "@/app/api/staff/session/route";
import { POST as everywhere } from "@/app/api/staff/session/everywhere/route";
import { POST as reveal } from "@/app/api/staff/reveal/route";
import { POST as act } from "@/app/api/staff/actions/route";
import { alertOnReveals, REVEALS_PER_HOUR, revealAlertRef } from "./reveal-limit";
import { touchLastSeen } from "@/lib/server/accounts";
import { pruneStaffAudit } from "@/lib/server/cron-runs";
import { readBudgets } from "./budgets";

let sql: SqlClient;
let close: () => Promise<void>;
const ORIGIN = "http://localhost:3220";
let admin: string, admin2: string, person: string;

async function account(email: string | null, did: string) {
  const rows = (await sql.query(`insert into users (privy_did, email) values ($1, $2) returning id`, [did, email])) as { id: string }[];
  if (email) await sql.query(`insert into user_identities (user_id, kind, value, is_primary, proof) values ($1, 'email', $2, true, 'privy_email')`, [rows[0].id, email]);
  return rows[0].id;
}
async function cookieFor(userId: string, authAt: number | null = Date.now()) {
  const session = await createStaffSession(userId, authAt, Date.now() + 3_600_000);
  return { session, header: `${staffCookieName()}=${await mintStaffCookie({ sessionId: session.id, expiresAt: session.expiresAt }, staffSessionKey()!)}` };
}
function req(path: string, { method = "POST", cookie, auth, body }: { method?: string; cookie?: string; auth?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { host: "localhost:3220", origin: ORIGIN, "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  if (auth) headers.authorization = auth;
  return new Request(`${ORIGIN}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function statusOf(call: Promise<Response>): Promise<number> {
  try {
    return (await call).status;
  } catch (error) {
    if (/404|NEXT_NOT_FOUND|NEXT_HTTP_ERROR_FALLBACK/.test(`${(error as { digest?: string }).digest ?? ""} ${(error as Error).message}`)) return 404;
    throw error;
  }
}

beforeAll(async () => {
  const db = await makeTestDb();
  sql = db.sql;
  close = db.close;
  setSqlClient(sql);
  admin = await account("admin@example.com", "did:privy:admin");
  admin2 = await account("second@example.com", "did:privy:admin2");
  person = await account("sailor@example.com", "did:privy:person");
});
beforeEach(() => {
  vi.stubEnv("STAFF_SESSION_SECRET", "r".repeat(48));
  vi.stubEnv("STAFF_ADMIN_IDS", `${admin},${admin2}`);
  verify.mockReset();
  verifiedAt.mockReset();
});
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  setSqlClient(null);
  await close();
});

describe("staff sessions", () => {
  it("live as long as their token, renew from a newer one, never past twelve hours", async () => {
    const now = Date.now();
    const session = await createStaffSession(admin, now, now + 3_600_000, now);
    expect(await readLiveSession(session.id, now + 3_599_000)).not.toBeNull();
    expect(await readLiveSession(session.id, now + 3_601_000)).toBeNull();
    const renewed = await renewStaffSession(session.id, admin, now + 60_000, now + 7_200_000, now + 10_000);
    expect(renewed?.expiresAt).toBe(now + 7_200_000);
    expect(renewed?.authAt).toBe(now + 60_000);
    const capped = await renewStaffSession(session.id, admin, null, now + 48 * 3_600_000, now + 20_000);
    expect(capped!.expiresAt).toBeLessThanOrEqual(now + 12 * 3_600_000);
    expect(await renewStaffSession(session.id, admin2, null, now + 7_200_000, now)).toBeNull();
  });

  it("end everywhere at once, and a merged away account has none", async () => {
    const a = await cookieFor(admin);
    const b = await cookieFor(admin);
    expect(await staffFromCookie(a.header.split("=")[1])).toMatchObject({ userId: admin, role: "admin" });
    const response = await everywhere(req("/api/staff/session/everywhere", { cookie: a.header }));
    expect(await response.json()).toMatchObject({ ok: true });
    expect(await staffFromCookie(a.header.split("=")[1])).toBeNull();
    expect(await staffFromCookie(b.header.split("=")[1])).toBeNull();
    const c = await cookieFor(admin2);
    await sql.query(`update users set retired_into = $2 where id = $1`, [admin2, admin]);
    expect(await staffFromCookie(c.header.split("=")[1])).toBeNull();
    await sql.query(`update users set retired_into = null where id = $1`, [admin2]);
  });

  it("the door refuses an account with no email code, mints for one with, and renews its own", async () => {
    verify.mockResolvedValue({ did: "did:privy:admin", expiresAt: Date.now() + 3_600_000 });
    verifiedAt.mockResolvedValueOnce(null);
    expect(await statusOf(door(req("/api/staff/session", { auth: "Bearer t" }) as never))).toBe(404);
    verifiedAt.mockResolvedValue(Date.now());
    const first = await door(req("/api/staff/session", { auth: "Bearer t" }) as never);
    expect(first.status).toBe(200);
    const set = first.headers.get("set-cookie")!;
    const value = set.split(";")[0];
    const before = Number(((await sql.query(`select count(*)::int as n from staff_sessions where staff_user_id = $1 and revoked_at is null`, [admin])) as { n: number }[])[0].n);
    const again = await door(req("/api/staff/session", { auth: "Bearer t", cookie: value }) as never);
    expect(again.status).toBe(200);
    const after = Number(((await sql.query(`select count(*)::int as n from staff_sessions where staff_user_id = $1 and revoked_at is null`, [admin])) as { n: number }[])[0].n);
    expect(after).toBe(before);
    // Sign out ends this browser's session.
    await leave(req("/api/staff/session", { method: "DELETE", cookie: value }) as never);
    expect(await staffFromCookie(value.split("=")[1])).toBeNull();
    await revokeAllStaffSessions(admin);
  });
});

describe("the reveal ceiling", () => {
  it("refuses past twenty an hour", async () => {
    const { header } = await cookieFor(admin);
    const identity = ((await sql.query(`select id from user_identities where user_id = $1`, [person])) as { id: string }[])[0].id;
    await sql.query(
      `insert into staff_audit (staff_user_id, action, target) select $1, 'reveal_email', 'user:x' from generate_series(1, $2::int)`,
      [admin, REVEALS_PER_HOUR],
    );
    const refused = await reveal(req("/api/staff/reveal", { cookie: header, body: { userId: person, identityId: identity, reason: "support ticket" } }));
    expect(refused.status).toBe(429);
    await sql.query(`delete from staff_audit where action = 'reveal_email'`);
    const ok = await reveal(req("/api/staff/reveal", { cookie: header, body: { userId: person, identityId: identity, reason: "support ticket" } }));
    expect(ok.status).toBe(200);
  });

  it("tells the other admins once an hour at ten", async () => {
    const sent: string[] = [];
    const send = async (input: { userId: string; ref: string }) => {
      sent.push(`${input.userId}|${input.ref}`);
      return "sent" as const;
    };
    const now = new Date("2026-10-02T10:15:00Z");
    expect(await alertOnReveals(admin, 9, { now, send: send as never, admins: [admin, admin2] })).toBe(0);
    expect(await alertOnReveals(admin, 10, { now, send: send as never, admins: [admin, admin2] })).toBe(1);
    expect(sent).toEqual([`${admin2}|${revealAlertRef(admin, admin2, now)}`]);
    expect(revealAlertRef(admin, admin2, now)).toBe(revealAlertRef(admin, admin2, new Date("2026-10-02T10:59:00Z")));
  });
});

describe("sealed searches", () => {
  it("open only for the staff member who sealed them", async () => {
    const key = staffSessionKey()!;
    const sealed = await sealSearch("sailor@example.com", key, admin);
    expect(await openSearch(sealed, key, admin)).toBe("sailor@example.com");
    expect(await openSearch(sealed, key, admin2)).toBeNull();
  });
});

describe("last seen", () => {
  it("is bumped at most once a UTC day", async () => {
    await touchLastSeen(person);
    const first = ((await sql.query(`select last_seen_at from users where id = $1`, [person])) as { last_seen_at: string }[])[0].last_seen_at;
    expect(first).not.toBeNull();
    await touchLastSeen(person);
    const second = ((await sql.query(`select last_seen_at from users where id = $1`, [person])) as { last_seen_at: string }[])[0].last_seen_at;
    expect(new Date(second).getTime()).toBe(new Date(first).getTime());
    await sql.query(`update users set last_seen_at = now() - interval '2 days' where id = $1`, [person]);
    await touchLastSeen(person);
    const third = ((await sql.query(`select last_seen_at from users where id = $1`, [person])) as { last_seen_at: string }[])[0].last_seen_at;
    expect(Date.now() - new Date(third).getTime()).toBeLessThan(60_000);
  });
});

describe("budget edges and the prune", () => {
  it("counts spend from the latest saving, even of the same balance", async () => {
    const { header } = await cookieFor(admin);
    await act(req("/api/staff/actions", { cookie: header, body: { action: "budget", service: "jev", balanceUsd: "5", reason: "read off console" } }));
    await sql.query(`update staff_budgets set balance_at = now() - interval '9 days' where service = 'jev'`);
    await act(req("/api/staff/actions", { cookie: header, body: { action: "budget", service: "jev", balanceUsd: "5", reason: "topped up to five" } }));
    const at = (await readBudgets()).find((row) => row.id === "jev")!.settings.balanceAt!;
    expect(Date.now() - new Date(at).getTime()).toBeLessThan(60_000);
  });

  it("gives up a budget alert left pending from an earlier day", async () => {
    const { setEmailTransport, retryPendingSends } = await import("@/lib/server/email/send");
    const sent: string[] = [];
    setEmailTransport(async (email) => {
      sent.push(email.subject);
      return { ok: true, id: "re" };
    });
    await sql.query(
      `insert into email_sends (user_id, type, ref, status, notice, created_at)
       values ($1, 'budget_low', $2, 'pending', '{"type":"budget_low","service":"jev","remaining":"$0.50","daysLeft":null,"estimate":true}', now() - interval '1 day')`,
      [admin, `jev:2026-09-01:${admin}`],
    );
    const summary = await retryPendingSends();
    expect(summary.gaveUp).toBe(1);
    expect(sent).toEqual([]);
    setEmailTransport(null);
  });

  it("prunes staff audit rows older than 24 months on its own", async () => {
    await sql.query(`insert into staff_audit (staff_user_id, action, at) values ($1, 'old_thing', now() - interval '25 months'), ($1, 'new_thing', now())`, [admin]);
    await pruneStaffAudit();
    const actions = ((await sql.query(`select action from staff_audit where action in ('old_thing', 'new_thing')`)) as { action: string }[]).map((r) => r.action);
    expect(actions).toEqual(["new_thing"]);
  });
});
