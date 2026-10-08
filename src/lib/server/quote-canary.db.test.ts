import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SmokeAttempt, SmokeJob } from "@/lib/quote-smoke";

/**
 * The quote canary against the real schema: each run is kept, the second
 * failing run in a row inside market hours emails every staff admin, at most
 * once an hour, and a run outside market hours or after a pass never does.
 * The solver is a stub; the email sender is a spy.
 */

const { setSqlClient, getSql } = await import("./db");
const { makeTestDb } = await import("./pglite-test-db");
const { runCanary, lastCanaryRuns, shouldAlert, alertRef, exampleLine, IN_A_ROW_WINDOW_MS } = await import("./quote-canary");
const { GET } = await import("@/app/api/cron/canary/route");

let close: () => Promise<void>;
beforeAll(async () => {
  const db = await makeTestDb();
  setSqlClient(db.sql);
  close = db.close;
});
afterAll(async () => close());
beforeEach(async () => {
  await getSql().query("delete from quote_canary_runs");
});

const payload = {} as SmokeJob["payload"];
const jobs: SmokeJob[] = [
  { dir: "buy", src: "USDC@0x2105.base", dst: "NVDA", usd: 5, stock: true, payload },
  { dir: "sell", src: "SPY", dst: "USDC@0x2105.base", usd: 5, stock: true, payload },
  { dir: "control", src: "USDC@0x2105.base", dst: "USDC@0xa4b1.arbitrum", usd: 5, stock: false, payload },
];
const stocksDown = async (job: SmokeJob): Promise<SmokeAttempt> =>
  job.dir === "control" ? { status: "ok" } : { status: "no_path", code: -4, message: "No path was found between 0x72e852545b024ddcbc5b70c1bcbdaa025164259c and 0x2d5d" };
const allGood = async (): Promise<SmokeAttempt> => ({ status: "ok" });

// Thursday 8 October 2026: 16:00 UTC is 12:00 in New York, the market open; 02:00 UTC is closed.
const open1 = new Date("2026-10-08T16:00:00Z");
const open2 = new Date("2026-10-08T16:15:00Z");
const open3 = new Date("2026-10-08T16:30:00Z");
const nextHour = new Date("2026-10-08T17:00:00Z");
const closed1 = new Date("2026-10-09T02:00:00Z");
const closed2 = new Date("2026-10-09T02:15:00Z");
const ADMINS = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];

function sender() {
  const refs = new Set<string>();
  const send = vi.fn(async ({ ref }: { ref: string }) => {
    if (refs.has(ref)) return "duplicate" as const;
    refs.add(ref);
    return "sent" as const;
  });
  return send;
}

describe("runCanary", () => {
  it("keeps a passing run and emails nobody", async () => {
    const send = sender();
    const summary = await runCanary({ now: open1, jobs, ask: allGood, send: send as never, admins: ADMINS });
    expect(summary).toMatchObject({ verdict: "pass", quoted: 3, total: 3, alerted: false, recorded: true, marketOpen: true });
    expect(send).not.toHaveBeenCalled();
    expect((await lastCanaryRuns())[0]).toMatchObject({ verdict: "pass", failed: [] });
  });

  it("emails every admin on the second failing run in a row in market hours, once an hour", async () => {
    const send = sender();
    const args = { jobs, ask: stocksDown, send: send as never, admins: ADMINS };
    const first = await runCanary({ ...args, now: open1 });
    expect(first).toMatchObject({ verdict: "solver_down", alerted: false });
    expect(send).not.toHaveBeenCalled();

    const second = await runCanary({ ...args, now: open2 });
    expect(second).toMatchObject({ verdict: "solver_down", alerted: true, emailed: 2 });
    expect(send).toHaveBeenCalledTimes(2);
    const notice = send.mock.calls[0][0] as unknown as { notice: Record<string, unknown> };
    expect(notice.notice).toMatchObject({ type: "quotes_down", solverSide: true, failed: 2, total: 3 });
    expect(String(notice.notice.example)).toMatch(/^USDC@0x2105\.base to NVDA: -4 No path/);
    expect(String(notice.notice.example)).not.toMatch(/0x72e852545b/);

    // The same hour: the ref is taken, nothing more goes out.
    const third = await runCanary({ ...args, now: open3 });
    expect(third).toMatchObject({ alerted: false, emailed: 0 });
    // The next hour: once more.
    const fourth = await runCanary({ ...args, now: nextHour });
    expect(fourth).toMatchObject({ alerted: true, emailed: 2 });
  });

  it("never emails outside market hours", async () => {
    const send = sender();
    const args = { jobs, ask: stocksDown, send: send as never, admins: ADMINS };
    await runCanary({ ...args, now: closed1 });
    const second = await runCanary({ ...args, now: closed2 });
    expect(second).toMatchObject({ verdict: "solver_down", marketOpen: false, alerted: false });
    expect(send).not.toHaveBeenCalled();
    const [last] = await lastCanaryRuns();
    expect(last).toMatchObject({ marketOpen: false, quoted: 1, total: 3 });
    expect(last.failed[0]).toMatchObject({ dir: "buy", dst: "NVDA", status: "no_path", code: -4 });
  });
});

describe("the budget (guards review M2)", () => {
  it("records a row inside the budget even when a quote never answers, as a failure", async () => {
    const send = sender();
    const hang = async (job: SmokeJob): Promise<SmokeAttempt> => (job.dst === "NVDA" ? new Promise(() => {}) : { status: "ok" });
    const t0 = Date.now();
    const summary = await runCanary({ now: open1, jobs, ask: hang, budgetMs: 200, send: send as never, admins: ADMINS });
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(summary).toMatchObject({ verdict: "fail", quoted: 2, total: 3, recorded: true });
    const [last] = await lastCanaryRuns();
    expect(last.failed[0]).toMatchObject({ dst: "NVDA", status: "error" });
    expect(last.failed[0].message).toMatch(/no answer/);
  });

  it("asks every quote at once, with no retry inside the run", async () => {
    let inFlight = 0;
    let most = 0;
    const ask = vi.fn(async (): Promise<SmokeAttempt> => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight -= 1;
      return { status: "no_path", code: -4 };
    });
    await runCanary({ now: open1, jobs, ask, send: sender() as never, admins: ADMINS });
    expect(most).toBe(3);
    expect(ask).toHaveBeenCalledTimes(3);
  });

  it("judges flapping across runs", async () => {
    const args = { jobs, send: sender() as never, admins: ADMINS };
    await runCanary({ ...args, now: open1, ask: stocksDown });
    const second = await runCanary({ ...args, now: open2, ask: allGood });
    expect(second.flapping).toBe(2);
    const third = await runCanary({ ...args, now: open3, ask: allGood });
    expect(third.flapping).toBe(0);
  });
});

describe("shouldAlert", () => {
  const at = (iso: string) => new Date(iso).toISOString();
  it.each([
    ["two failures 15 minutes apart in hours", { verdict: "fail", marketOpen: true, startedAt: at("2026-10-08T16:15:00Z") }, { verdict: "solver_down", startedAt: at("2026-10-08T16:00:00Z") }, true],
    ["a failure after a pass", { verdict: "fail", marketOpen: true, startedAt: at("2026-10-08T16:15:00Z") }, { verdict: "pass", startedAt: at("2026-10-08T16:00:00Z") }, false],
    ["the first run ever", { verdict: "fail", marketOpen: true, startedAt: at("2026-10-08T16:15:00Z") }, null, false],
    ["a pass", { verdict: "pass", marketOpen: true, startedAt: at("2026-10-08T16:15:00Z") }, { verdict: "fail", startedAt: at("2026-10-08T16:00:00Z") }, false],
    ["the market closed", { verdict: "fail", marketOpen: false, startedAt: at("2026-10-08T16:15:00Z") }, { verdict: "fail", startedAt: at("2026-10-08T16:00:00Z") }, false],
    ["the last failure was yesterday", { verdict: "fail", marketOpen: true, startedAt: at("2026-10-08T14:00:00Z") }, { verdict: "fail", startedAt: at("2026-10-07T19:45:00Z") }, false],
  ] as const)("%s", (_, current, previous, expected) => {
    expect(shouldAlert({ current, previous })).toBe(expected);
  });

  it("a run is in a row within 70 minutes (runs are 30 minutes apart)", () => {
    expect(IN_A_ROW_WINDOW_MS).toBe(70 * 60 * 1000);
  });

  it("one ref per admin per UTC hour", () => {
    expect(alertRef("a", open1)).toBe(alertRef("a", open3));
    expect(alertRef("a", open1)).not.toBe(alertRef("a", nextHour));
    expect(alertRef("a", open1)).not.toBe(alertRef("b", open1));
  });

  it("the example line shortens long hex", () => {
    expect(exampleLine(undefined)).toBe("");
  });
});

describe("GET /api/cron/canary", () => {
  it("refuses without the secret, and is closed when none is set", async () => {
    const { NextRequest } = await import("next/server");
    const saved = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    expect((await GET(new NextRequest("http://x/api/cron/canary"))).status).toBe(503);
    process.env.CRON_SECRET = "canary-test-secret";
    expect((await GET(new NextRequest("http://x/api/cron/canary", { headers: { authorization: "Bearer wrong" } }))).status).toBe(401);
    if (saved === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = saved;
  });
});
