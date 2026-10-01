import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const staffFromCookie = vi.fn();
vi.mock("@/lib/server/staff-gate", () => ({ staffFromCookie: (...args: unknown[]) => staffFromCookie(...args) }));
const verify = vi.fn();
vi.mock("@/lib/server/privy", () => ({ verifyPrivyToken: (...args: unknown[]) => verify(...args) }));
const account = vi.fn();
vi.mock("@/lib/server/accounts", () => ({ accountForDid: (...args: unknown[]) => account(...args) }));

import { proxy, STAFF_HEADERS } from "./proxy";

const NOWHERE = "/_berth/not-a-page";

const ADMIN = "11111111-1111-4111-8111-111111111111";
const call = (path: string, init: { cookie?: string; method?: string; auth?: string } = {}) =>
  proxy(
    new NextRequest(`http://localhost:3220${path}`, {
      method: init.method ?? "GET",
      headers: { ...(init.cookie ? { cookie: init.cookie } : {}), ...(init.auth ? { authorization: init.auth } : {}) },
    }),
  );
/** Whether the proxy refused: passed on marked, credentials off (next.config then serves the unknown address). */
const forwarded = (response: Response, key: string) => response.headers.get(`x-middleware-request-${key}`);
const rewritten = (response: Response) => (forwarded(response, "x-berth-refused") === "1" ? NOWHERE : null);


describe("the staff proxy", () => {
  beforeEach(() => {
    vi.stubEnv("STAFF_ADMIN_IDS", ADMIN);
    staffFromCookie.mockReset();
    staffFromCookie.mockResolvedValue(null);
    verify.mockReset();
    account.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("leaves a request with neither cookie nor token to next.config's rewrite, adding nothing", async () => {
    for (const method of ["GET", "HEAD", "POST", "DELETE", "OPTIONS"]) {
      const response = await call("/staff/campaigns", { method });
      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(rewritten(response)).toBeNull();
      for (const header of Object.keys(STAFF_HEADERS)) expect(response.headers.get(header)).toBeNull();
    }
    expect(staffFromCookie).not.toHaveBeenCalled();
  });

  it("answers a bad cookie or a token that is not staff as the unknown address, any method, with no staff header", async () => {
    for (const method of ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      for (const path of ["/staff", "/staff/users", "/staff/campaigns", "/api/staff", "/api/staff/actions", "/api/staff/campaigns", "/api/staff/session"]) {
        const response = await call(path, { method, auth: "Bearer junk", cookie: "berth-staff=forged" });
        expect(rewritten(response), `${method} ${path}`).toContain(NOWHERE);
        // No answer of its own, no request of its own, and the credentials do not go on.
        expect(response.headers.get("x-middleware-next")).toBe("1");
        expect(response.headers.get("x-middleware-rewrite")).toBeNull();
        expect(forwarded(response, "cookie")).toBeNull();
        expect(forwarded(response, "authorization")).toBeNull();
        for (const header of Object.keys(STAFF_HEADERS)) expect(response.headers.get(header), `${method} ${path} ${header}`).toBeNull();
      }
    }
  });

  it("lets a live session in, with the strict headers", async () => {
    staffFromCookie.mockResolvedValue({ userId: ADMIN, role: "admin" });
    const response = await call("/staff", { cookie: "berth-staff=x" });
    expect(rewritten(response)).toBeNull();
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("opens the door only for a valid Privy token of an account on the list", async () => {
    verify.mockResolvedValueOnce({ did: "did:privy:a", expiresAt: Date.now() + 1000 });
    account.mockResolvedValueOnce({ id: ADMIN });
    expect(rewritten(await call("/api/staff/session", { method: "POST", auth: "Bearer t" }))).toBeNull();
    verify.mockResolvedValueOnce({ did: "did:privy:b", expiresAt: Date.now() + 1000 });
    account.mockResolvedValueOnce({ id: "22222222-2222-4222-8222-222222222222" });
    expect(rewritten(await call("/api/staff/session", { method: "POST", auth: "Bearer t" }))).toContain(NOWHERE);
    verify.mockResolvedValueOnce({ did: "did:privy:a", expiresAt: Date.now() + 1000 });
    account.mockResolvedValueOnce({ id: ADMIN });
    // The door is POST only; a token opens nothing else.
    expect(rewritten(await call("/api/staff/actions", { method: "POST", auth: "Bearer t" }))).toContain(NOWHERE);
  });

  it("opens nothing when the database cannot be asked", async () => {
    staffFromCookie.mockRejectedValue(new Error("down"));
    expect(rewritten(await call("/staff", { cookie: "berth-staff=x" }))).toContain(NOWHERE);
  });
});
