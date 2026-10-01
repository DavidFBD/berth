import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * What must never be geo gated (lib/availability): webhooks, crons, the
 * email unsubscribe, /mcp and its OAuth metadata and token endpoints, and
 * the solver proxy, which carries a traveller's sells. Their
 * callers are Resend, Vercel's scheduler and an assistant's servers, whose
 * country says nothing about the person, and an unsubscribe must work from
 * anywhere. Two checks: none of them reads the gate, and a request from the
 * United States gets the same answer as any other.
 */

const UNTOUCHED = [
  "api/email/webhook/route.ts",
  "api/email/unsubscribe/route.ts",
  "email/u/page.tsx",
  "api/cron/morning/route.ts",
  "api/cron/evening/route.ts",
  "mcp/route.ts",
  "oauth/token/route.ts",
  "oauth/register/route.ts",
  "oauth/revoke/route.ts",
  ".well-known/oauth-authorization-server/route.ts",
  ".well-known/oauth-protected-resource/route.ts",
  ".well-known/oauth-protected-resource/mcp/route.ts",
  // The solver proxy carries sells too: a gate here would silently end the
  // traveller's exception.
  "api/sodax/[...path]/route.ts",
];

const GATE = /availability|refuseWhereUnavailable|x-vercel-ip-country|rewards-route/;

describe("routes the gate never touches", () => {
  it.each(UNTOUCHED)("%s does not read the availability gate", (file) => {
    const source = readFileSync(join(__dirname, file), "utf8");
    expect(source).not.toMatch(GATE);
  });
});

vi.mock("@/lib/server/email/store", () => ({ setPref: vi.fn(async () => undefined) }));
vi.mock("@/lib/server/email/token", () => ({
  readUnsubscribeToken: vi.fn(async (token: string) => (token === "good" ? { userId: "u1", kind: "limit_filled" } : null)),
}));

// Each case imports a whole route cold (the cron routes pull in the holds,
// the campaign step and the SDK): under a loaded test run that takes longer
// than vitest's default five seconds.
describe("a request from the United States", { timeout: 30_000 }, () => {
  const US = { "x-vercel-ip-country": "US", "x-vercel-ip-country-region": "CA" };

  it("unsubscribes in one click, as from anywhere", async () => {
    const { POST } = await import("./api/email/unsubscribe/route");
    const request = new NextRequest("http://localhost/api/email/unsubscribe?t=good", {
      method: "POST",
      headers: { ...US, "content-type": "application/x-www-form-urlencoded" },
      body: "List-Unsubscribe=One-Click",
    });
    const response = await POST(request);
    expect(response.status).not.toBe(451);
    expect(response.status).toBeLessThan(400);
  });

  it("reaches the cron's own auth, not a country refusal", async () => {
    const { GET } = await import("./api/cron/evening/route");
    const response = await GET(new NextRequest("http://localhost/api/cron/evening", { headers: US }));
    expect(response.status).not.toBe(451);
  });

  it("reaches the webhook's own signature check, not a country refusal", async () => {
    const { POST } = await import("./api/email/webhook/route");
    const response = await POST(new NextRequest("http://localhost/api/email/webhook", { method: "POST", headers: US, body: "{}" }));
    expect(response.status).not.toBe(451);
  });
});
