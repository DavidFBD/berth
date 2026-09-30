import { describe, expect, it } from "vitest";
import { runMorning } from "./morning";

/** The morning run's stages with stand-ins: the weekly summary is its own stage and never fails the run. */

const holds = async () => ({}) as never;
const recurring = async () => ({ aged: 0, made: 0, emailed: 0, notEmailed: 0, deferred: 0 });
const emails = async () => ({ retried: 0, sent: 0, gaveUp: 0 });
const budgets = { holds: 1_000, recurring: 1_000, emails: 1_000, weekly: 50 };

describe("runMorning", () => {
  it("runs the weekly summary after the email retry, never beside it", async () => {
    const order: string[] = [];
    let budget = -1;
    await runMorning({
      holds,
      recurring,
      emails: async () => {
        order.push("emails:start");
        await new Promise((resolve) => setTimeout(resolve, 20));
        order.push("emails:end");
        return { retried: 0, sent: 0, gaveUp: 0 };
      },
      weekly: async (budgetMs) => {
        order.push("weekly:start");
        budget = budgetMs;
        return { week: null, sent: 0, empty: 0, notSent: 0, deferred: 0 };
      },
      budgets,
    });
    expect(order).toEqual(["emails:start", "emails:end", "weekly:start"]);
    expect(budget).toBe(50);
  });

  it("gives the weekly stage only what the run has left", async () => {
    let now = 0;
    let budget = -1;
    const summary = await runMorning({
      holds: async () => {
        now += 55_000;
        return {} as never;
      },
      recurring,
      emails,
      weekly: async (budgetMs) => {
        budget = budgetMs;
        return { week: null, sent: 0, empty: 0, notSent: 0, deferred: 0 };
      },
      budgets: { holds: 1_000, recurring: 1_000, emails: 1_000, weekly: 10_000, run: 57_000 },
      clock: () => now,
    });
    expect(budget).toBe(2_000);
    expect(summary.weekly.ok).toBe(true);
  });

  it("reports the weekly summary's own result", async () => {
    const summary = await runMorning({
      holds,
      recurring,
      emails,
      weekly: async () => ({ week: "2026-W39", sent: 2, empty: 0, notSent: 0, deferred: 0 }),
      budgets,
    });
    expect(summary.weekly).toEqual({ ok: true, result: { week: "2026-W39", sent: 2, empty: 0, notSent: 0, deferred: 0 } });
    expect(summary.failed).toBe(false);
  });

  it("reports a weekly stage that throws or overruns without failing the run", async () => {
    const thrown = await runMorning({ holds, recurring, emails, weekly: async () => Promise.reject(new Error("db down")), budgets });
    expect(thrown.weekly).toEqual({ ok: false, error: "db down" });
    expect(thrown.emails.ok).toBe(true);
    expect(thrown.failed).toBe(false);
    const slow = await runMorning({ holds, recurring, emails, weekly: () => new Promise(() => undefined), budgets });
    expect(slow.weekly).toEqual({ ok: false, error: "over its 50ms budget" });
    expect(slow.failed).toBe(false);
  });
});
