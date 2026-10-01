import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy, config } from "./proxy";
import { issueStaffPagePass, NOWHERE_PATH } from "@/lib/server/staff-page";

/**
 * The staff page's outer door: without a live pass the request is rewritten
 * to the very address an unknown path is, so the two answers cannot differ;
 * with one it goes on to the page, which asks again.
 */

const ID = "0f0e0d0c-0000-4000-8000-000000000001";
const at = (path: string, cookie?: string) =>
  new NextRequest(`http://localhost${path}`, { headers: cookie ? { cookie: `berth_staff=${cookie}` } : {} });

describe("proxy", () => {
  beforeEach(() => {
    vi.stubEnv("SESSION_SECRET", "test-secret-for-the-staff-page-pass");
    vi.stubEnv("STAFF_ADMIN_IDS", ID);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("leaves a request with no pass to next.config's rewrite, which adds no header of its own", async () => {
    expect((await proxy(at("/staff/campaigns"))).headers.get("x-middleware-next")).toBe("1");
    const config = (await import("../next.config")).default;
    const rewrites = (await config.rewrites!()) as {
      beforeFiles: { source: string; missing: unknown[]; destination: string }[];
      fallback: { source: string; destination: string }[];
    };
    expect(rewrites.fallback).toEqual([{ source: "/:path((?!_next/).*)", destination: NOWHERE_PATH }]);
    expect(rewrites.beforeFiles).toEqual([
      { source: "/staff/campaigns", missing: [{ type: "cookie", key: "berth_staff" }], destination: NOWHERE_PATH },
      { source: "/staff/campaigns/:path*", missing: [{ type: "cookie", key: "berth_staff" }], destination: NOWHERE_PATH },
    ]);
  });

  it("rewrites the staff page to the unknown address with a forged pass, or one off the list", async () => {
    const off = await issueStaffPagePass("0f0e0d0c-0000-4000-8000-000000000002");
    for (const request of [at("/staff/campaigns", "forged"), at("/staff/campaigns", off), at("/staff/campaigns/x", "forged")]) {
      const response = await proxy(request);
      expect(new URL(response.headers.get("x-middleware-rewrite")!).pathname).toBe(NOWHERE_PATH);
    }
  });

  it("lets a live pass through to the page", async () => {
    const response = await proxy(at("/staff/campaigns", await issueStaffPagePass(ID)));
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("guards the staff page only", () => {
    expect(config.matcher).toEqual(["/staff/campaigns", "/staff/campaigns/:path*"]);
  });
});
