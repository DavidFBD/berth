import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined) }),
}));
vi.mock("next/navigation", () => ({
  unstable_rethrow: (error: unknown) => {
    if (error instanceof Error && error.message === "NEXT_NOT_FOUND") throw error;
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
const query = vi.fn();
vi.mock("@/lib/server/db", () => ({ getSql: () => ({ query }) }));
// Sessions by id (staff_sessions), with a switch to make the database fail.
const sessions = new Map<string, { id: string; userId: string; authAt: number | null; expiresAt: number }>();
let sessionsDown = false;
vi.mock("@/lib/server/staff-sessions", () => ({
  readLiveSession: async (id: string) => {
    if (sessionsDown) throw new Error("down");
    const row = sessions.get(id);
    return row && row.expiresAt > Date.now() ? row : null;
  },
}));

import { staffGate, staffAdminIds, recordStaff, staffRoleFor, staffRoute, StaffAccessError, sameOrigin } from "./staff-gate";
import { mintStaffCookie, readStaffSessionToken, STAFF_FRESH_MS, staffCookieName, staffFresh, staffSessionKey } from "./staff-session";


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

const ADMIN = "11111111-1111-4111-8111-111111111111";
const VIEWER = "22222222-2222-4222-8222-222222222222";
const STRANGER = "33333333-3333-4333-8333-333333333333";
const SECRET = "s".repeat(48);

let sid = 0;
async function sessionFor(userId: string, authAt: number | null = Date.now()) {
  sid += 1;
  const id = `00000000-0000-4000-8000-${String(sid).padStart(12, "0")}`;
  sessions.set(id, { id, userId, authAt, expiresAt: Date.now() + 3_600_000 });
  return mintStaffCookie({ sessionId: id, expiresAt: Date.now() + 3_600_000 }, staffSessionKey()!);
}

function request(cookie: string | null, init: { method?: string; origin?: string | null } = {}) {
  const headers: Record<string, string> = { host: "localhost:3220" };
  if (cookie) headers.cookie = `${staffCookieName()}=${cookie}`;
  if (init.origin !== null) headers.origin = init.origin ?? "http://localhost:3220";
  return new Request("http://localhost:3220/api/staff/x", { method: init.method ?? "GET", headers });
}

beforeEach(() => {
  vi.stubEnv("STAFF_SESSION_SECRET", SECRET);
  vi.stubEnv("STAFF_ADMIN_IDS", `${ADMIN}, not-a-uuid`);
  vi.stubEnv("STAFF_VIEWER_IDS", VIEWER);
  cookieJar.clear();
  query.mockReset();
  query.mockResolvedValue([{ retired_into: null }]);
});
afterEach(() => vi.unstubAllEnvs());

describe("the allowlist", () => {
  it("reads roles from the environment, admins first, malformed ids ignored", () => {
    expect(staffAdminIds()).toEqual([ADMIN]);
    expect(staffRoleFor(ADMIN)).toBe("admin");
    expect(staffRoleFor(ADMIN.toUpperCase())).toBe("admin");
    expect(staffRoleFor(VIEWER)).toBe("viewer");
    expect(staffRoleFor(STRANGER)).toBeNull();
    vi.stubEnv("STAFF_VIEWER_IDS", `${VIEWER},${ADMIN}`);
    expect(staffRoleFor(ADMIN)).toBe("admin");
  });

  it("is not the @sodax.com rule", () => {
    expect(staffRoleFor("did:privy:x")).toBeNull();
  });
});

describe("the session cookie", () => {
  it("round trips and refuses tampering, other keys and expiry", async () => {
    const now = Date.now();
    const SID = "44444444-4444-4444-8444-444444444444";
    const token = await mintStaffCookie({ sessionId: SID, expiresAt: now + 3_600_000 }, staffSessionKey()!, now);
    // The cookie carries the session id and nothing else about the person.
    expect(await readStaffSessionToken(token, staffSessionKey(), now)).toEqual({ sessionId: SID, issuedAt: Math.floor(now / 1000) * 1000 });
    expect(Buffer.from(token.split(".")[1], "base64url").toString()).not.toContain(ADMIN);
    // It ends with the session's end, never later than twelve hours.
    expect(await readStaffSessionToken(token, staffSessionKey(), now + 3_601_000)).toBeNull();
    expect(await readStaffSessionToken(`${token}x`, staffSessionKey(), now)).toBeNull();
    expect(await readStaffSessionToken(token, new TextEncoder().encode("o".repeat(40)), now)).toBeNull();
  });

  it("needs a secret of at least 32 characters", () => {
    vi.stubEnv("STAFF_SESSION_SECRET", "short");
    expect(staffSessionKey()).toBeNull();
  });

  it("is fresh for 15 minutes after the email code", () => {
    const now = Date.now();
    expect(staffFresh(now - STAFF_FRESH_MS + 1000, now)).toBe(true);
    expect(staffFresh(now - STAFF_FRESH_MS - 1000, now)).toBe(false);
    expect(staffFresh(null, now)).toBe(false);
  });
});

describe("staffGate", () => {
  it("is not found on a page for no cookie, a stranger, a revoked or ended session, or no secret", async () => {
    await expect(staffGate("page")).rejects.toThrow("NEXT_NOT_FOUND");
    cookieJar.set(staffCookieName(), await sessionFor(STRANGER));
    await expect(staffGate("page")).rejects.toThrow("NEXT_NOT_FOUND");
    const cookie = await sessionFor(ADMIN);
    cookieJar.set(staffCookieName(), cookie);
    await expect(staffGate("page")).resolves.toMatchObject({ userId: ADMIN });
    // Revoked ("Sign out everywhere", a Berth sign out) or a retired account: the row is no longer live.
    sessions.clear();
    await expect(staffGate("page")).rejects.toThrow("NEXT_NOT_FOUND");
    vi.stubEnv("STAFF_SESSION_SECRET", "");
    await expect(staffGate("page")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("lets staff in and hides admin doors from a viewer", async () => {
    cookieJar.set(staffCookieName(), await sessionFor(VIEWER));
    await expect(staffGate("page")).resolves.toMatchObject({ userId: VIEWER, role: "viewer", fresh: true });
    await expect(staffGate("page", "admin")).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(staffGate("action", "admin")).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(staffGate(request(await sessionFor(VIEWER)), "admin")).rejects.toMatchObject({ status: 403 });
  });

  it("removing an id from the allowlist ends a live session", async () => {
    cookieJar.set(staffCookieName(), await sessionFor(ADMIN));
    await expect(staffGate("page")).resolves.toMatchObject({ role: "admin" });
    vi.stubEnv("STAFF_ADMIN_IDS", "");
    vi.stubEnv("STAFF_VIEWER_IDS", "");
    await expect(staffGate("page")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("refuses a stale proof where freshness is asked", async () => {
    const stale = await sessionFor(ADMIN, Date.now() - STAFF_FRESH_MS - 5_000);
    await expect(staffGate(request(stale), "admin")).resolves.toMatchObject({ fresh: false });
    await expect(staffGate(request(stale), "admin", { fresh: true })).rejects.toMatchObject({ status: 401, code: "stale" });
    await expect(staffGate(request(await sessionFor(ADMIN, null)), "admin", { fresh: true })).rejects.toBeInstanceOf(StaffAccessError);
  });

  it("treats a database that cannot be read as not found", async () => {
    const cookie = await sessionFor(ADMIN);
    sessionsDown = true;
    await expect(staffGate(request(cookie))).rejects.toMatchObject({ status: 404 });
    sessionsDown = false;
  });
});

describe("staffRoute", () => {
  const handler = staffRoute(async (staff) => Response.json({ who: staff.role }), { role: "admin", fresh: true });

  it("answers 404 for no cookie and for strangers, 403 for a viewer, 401 for stale", async () => {
    expect(await statusOf(handler(request(null, { method: "POST" })))).toBe(404);
    expect(await statusOf(handler(request(await sessionFor(STRANGER), { method: "POST" })))).toBe(404);
    expect(await statusOf(handler(request(await sessionFor(VIEWER), { method: "POST" })))).toBe(403);
    expect(await statusOf(handler(request(await sessionFor(ADMIN, Date.now() - STAFF_FRESH_MS * 2), { method: "POST" })))).toBe(401);
    const ok = await handler(request(await sessionFor(ADMIN), { method: "POST" }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toContain("no-store");
  });

  it("answers 404 to a write from another origin or none", async () => {
    expect(await statusOf(handler(request(await sessionFor(ADMIN), { method: "POST", origin: "https://evil.example" })))).toBe(404);
    expect(await statusOf(handler(request(await sessionFor(ADMIN), { method: "POST", origin: null })))).toBe(404);
    expect(sameOrigin(request(null))).toBe(true);
  });
});

describe("recordStaff", () => {
  it("writes the row with personal data scrubbed and refuses bad action names", async () => {
    query.mockResolvedValueOnce([]);
    await recordStaff({ userId: ADMIN }, "reveal_email", "user:abc", { reason: "support for x@y.io" });
    const [text, params] = query.mock.calls.at(-1)!;
    expect(text).toContain("insert into staff_audit");
    expect(params).toEqual([ADMIN, "reveal_email", "user:abc", JSON.stringify({ reason: "support for x***@y****.io" })]);
    await expect(recordStaff(ADMIN, "Drop table", null)).rejects.toThrow();
  });

  it("throws when the row cannot be written", async () => {
    query.mockRejectedValueOnce(new Error("down"));
    await expect(recordStaff(ADMIN, "reveal_email", "user:abc")).rejects.toThrow("down");
  });
});
