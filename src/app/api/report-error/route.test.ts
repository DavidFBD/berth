import { afterEach, describe, expect, it, vi } from "vitest";
import type { ErrorReportPayload } from "@/lib/error-report";

/**
 * The follow-up branch: how an unsettled order ended must land as a comment
 * on the issue its report opened, and never open an issue of its own.
 */
const FINGERPRINT = "0a1b2c3d";

function payload(overrides: Partial<ErrorReportPayload> = {}): ErrorReportPayload {
  return {
    action: "deposit",
    step: "settling",
    srcChainKey: "0x2105.base",
    errorCode: "SOLVER_FILL_UNSETTLED",
    friendlyMessage: "Sent, but not settled yet.",
    fingerprint: FINGERPRINT,
    logs: [],
    page: { url: "https://www.berthmarkets.com", userAgent: "test", viewport: "390x844", at: "2026-09-25T12:00:00.000Z" },
    ...overrides,
  };
}

type Call = { url: string; method: string; body?: string };

async function post(body: ErrorReportPayload, openIssues: { number: number; body: string }[]) {
  vi.resetModules();
  vi.stubEnv("GITHUB_ISSUE_TOKEN", "test-token");
  vi.stubEnv("GITHUB_ISSUE_REPO", "owner/repo");
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET", body: init?.body as string | undefined });
      if (url.includes("/issues?state=open")) return Response.json(openIssues);
      if (url.endsWith("/issues") && init?.method === "POST") return Response.json({ number: 99 });
      return Response.json({});
    }),
  );
  const { POST } = await import("./route");
  const response = await POST(
    new Request("http://localhost/api/report-error", {
      method: "POST",
      headers: { "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 250)}` },
      body: JSON.stringify(body),
    }),
  );
  return { result: await response.json(), calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("POST /api/report-error follow-ups", () => {
  it("comments on the unsettled issue it follows", async () => {
    const { result, calls } = await post(
      payload({ followUp: "Settled after 143s, intent 0xabc." }),
      [{ number: 42, body: `... fingerprint:${FINGERPRINT} ...` }],
    );
    expect(result).toEqual({ status: "duplicate", issueNumber: 42 });
    const comment = calls.find((call) => call.url.endsWith("/issues/42/comments"));
    expect(comment?.method).toBe("POST");
    expect(JSON.parse(comment!.body!).body).toContain("Settled after 143s, intent 0xabc.");
    expect(calls.some((call) => call.url.endsWith("/issues") && call.method === "POST")).toBe(false);
  });

  it("never opens a new issue when there is nothing to follow", async () => {
    const { result, calls } = await post(
      payload({ followUp: "Failed after 200s." }),
      [{ number: 7, body: "fingerprint:ffffffff" }],
    );
    expect(result.status).toBe("skipped");
    expect(calls.every((call) => call.method === "GET")).toBe(true);
  });

  it("still files an ordinary report as a new issue", async () => {
    const { result } = await post(payload(), []);
    expect(result).toEqual({ status: "filed", issueNumber: 99 });
  });
});
