import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const runHoldCheck = vi.fn();
const runRecurringMorning = vi.fn();
vi.mock("@/lib/server/holds", () => ({ runHoldCheck: () => runHoldCheck() }));
vi.mock("@/lib/server/recurring", () => ({ runRecurringMorning: () => runRecurringMorning(), reminderNotice: vi.fn() }));
vi.mock("@/lib/server/portfolio", () => ({ liveListingPrices: async () => ({}) }));
const runCampaignStep = vi.fn();
vi.mock("@/lib/server/campaigns/eligibility", () => ({ runCampaignStep: () => runCampaignStep() }));
const runWeeklySummaries = vi.fn();
vi.mock("@/lib/server/weekly", () => ({ runWeeklySummaries: () => runWeeklySummaries() }));
vi.mock("@/lib/server/staff/budgets", () => ({ runBudgetAlerts: async () => ({ low: 0, sent: 0, already: 0, failed: 0 }) }));
const recordCronRun = vi.fn();
vi.mock("@/lib/server/cron-runs", () => ({ recordCronRun: (...args: unknown[]) => recordCronRun(...args) }));

import { GET } from "./route";

const SECRET = "a".repeat(64);
const call = (authorization?: string) =>
  GET(
    new NextRequest("http://localhost/api/cron/morning", {
      headers: authorization ? { authorization } : {},
    }),
  );

describe("GET /api/cron/morning", () => {
  beforeEach(() => {
    runHoldCheck.mockReset();
    runHoldCheck.mockResolvedValue({ checked: 3, paid: 1, forfeited: 1, retried: 1 });
    runRecurringMorning.mockReset();
    runRecurringMorning.mockResolvedValue({ aged: 1, made: 2, emailed: 0, notEmailed: 2 });
    runCampaignStep.mockReset();
    runCampaignStep.mockResolvedValue({ advanced: 2, reserved: 1, expired: 0, judged: 1, qualified: 1, notHeld: 0, retried: 0 });
    runWeeklySummaries.mockReset();
    runWeeklySummaries.mockResolvedValue({ week: "2026-W39", sent: 1, empty: 0, notSent: 0, deferred: 0 });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails closed with 503 when no secret is configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const response = await call(`Bearer ${SECRET}`);
    expect(response.status).toBe(503);
    expect(runHoldCheck).not.toHaveBeenCalled();
  });

  it("answers 401 without the header or with the wrong secret", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    expect((await call()).status).toBe(401);
    expect((await call(`Bearer ${"b".repeat(64)}`)).status).toBe(401);
    expect((await call(SECRET)).status).toBe(401);
    expect(runHoldCheck).not.toHaveBeenCalled();
  });

  it("runs the stages in order and returns each summary with the right secret", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const response = await call(`Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    // The morning email pass rides along; with no key it does nothing.
    expect(await response.json()).toEqual({
      holds: { ok: true, result: { checked: 3, paid: 1, forfeited: 1, retried: 1 } },
      campaigns: { ok: true, result: { advanced: 2, reserved: 1, expired: 0, judged: 1, qualified: 1, notHeld: 0, retried: 0 } },
      recurring: { ok: true, result: { aged: 1, made: 2, emailed: 0, notEmailed: 2 } },
      emails: { ok: true, result: { retried: 0, sent: 0, gaveUp: 0 } },
      weekly: { ok: true, result: { week: "2026-W39", sent: 1, empty: 0, notSent: 0, deferred: 0 } },
      budgets: { ok: true, result: { low: 0, sent: 0, already: 0, failed: 0 } },
      failed: false,
    });
    // The run is recorded for the staff Health page.
    expect(recordCronRun).toHaveBeenCalledWith("morning", expect.any(Date), true, expect.objectContaining({ failed: false }));
    expect(runWeeklySummaries).toHaveBeenCalledOnce();
    expect(runHoldCheck).toHaveBeenCalledOnce();
    expect(runRecurringMorning).toHaveBeenCalledOnce();
    expect(runCampaignStep).toHaveBeenCalledOnce();
  });

  it("a failing campaign step is reported but does not fail the run", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    runCampaignStep.mockRejectedValue(new Error("db down"));
    const response = await call(`Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.campaigns).toEqual({ ok: false, error: "db down" });
    expect(body.recurring.ok).toBe(true);
  });

  it("a failing stage is reported and the next still runs", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    runHoldCheck.mockRejectedValue(new Error("rpc down"));
    const response = await call(`Bearer ${SECRET}`);
    // Still reported as failed to Vercel's cron log, though the others ran.
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.holds).toEqual({ ok: false, error: "rpc down" });
    expect(body.recurring.ok).toBe(true);
    expect(body.failed).toBe(true);
  });

  it("a failing weekly summary is reported but does not fail the run", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    runWeeklySummaries.mockRejectedValue(new Error("db down"));
    const response = await call(`Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.weekly).toEqual({ ok: false, error: "db down" });
    expect(body.failed).toBe(false);
  });
});
