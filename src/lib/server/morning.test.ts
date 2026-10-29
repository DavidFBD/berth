import { describe, expect, it } from "vitest";
import { runMorning } from "./morning";

/** The morning run's stages with stand-ins: the weekly summary is its own stage and never fails the run. */

const holds = async () => ({}) as never;
const campaigns = async () => ({ advanced: 0, reserved: 0, expired: 0, judged: 0, qualified: 0, notActive: 0 });
const emails = async () => ({ retried: 0, sent: 0, gaveUp: 0 });
const inviteXp = async () => ({ recorded: 0, paid: 0, paidBefore: 0, refused: 0, capped: 0, waiting: 0 });
const listings = async () => ({ observed: "none" as const, detected: 0, sending: { announcement: null, switchOn: true, sent: 0, notSent: 0, deferred: 0, finished: false } });
const budgets = { holds: 1_000, emails: 1_000, weekly: 50 };

describe("runMorning", () => {
  it("runs the weekly summary after the email retry, never beside it", async () => {
    const order: string[] = [];
    let budget = -1;
    await runMorning({ inviteXp, listings,
      holds,
      campaigns,
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
    let alertsRan = false;
    const summary = await runMorning({ inviteXp, listings,
      holds: async () => {
        now += 50_000;
        return {} as never;
      },
      emails,
      weekly: async (budgetMs) => {
        budget = budgetMs;
        now += budgetMs;
        return { week: null, sent: 0, empty: 0, notSent: 0, deferred: 0 };
      },
      budgetAlerts: async () => {
        alertsRan = true;
        return { low: 0, sent: 0, already: 0, failed: 0 };
      },
      budgets: { holds: 1_000, emails: 1_000, weekly: 10_000, run: 57_000 },
      clock: () => now,
    });
    // 7s left: the weekly stage gets it less the budget alerts' 4s, and the alerts the rest.
    expect(budget).toBe(3_000);
    expect(summary.weekly.ok).toBe(true);
    expect(alertsRan).toBe(true);
    expect(summary.budgets.ok).toBe(true);
  });

  it("skips the budget alerts when the run has no time left, never running past it", async () => {
    let now = 0;
    let alertsRan = false;
    const summary = await runMorning({ inviteXp, listings,
      holds: async () => {
        now += 58_000;
        return {} as never;
      },
      emails,
      weekly: async () => ({ week: null, sent: 0, empty: 0, notSent: 0, deferred: 0 }),
      budgetAlerts: async () => {
        alertsRan = true;
        return { low: 0, sent: 0, already: 0, failed: 0 };
      },
      budgets: { holds: 1_000, emails: 1_000, weekly: 10_000, run: 57_000 },
      clock: () => now,
    });
    expect(alertsRan).toBe(false);
    expect(summary.budgets).toEqual({ ok: false, error: "no time left" });
    expect(summary.failed).toBe(false);
  });

  it("runs New stocks after the weekly summary, in what the run has left less the budget alerts' share", async () => {
    let now = 0;
    const order: string[] = [];
    let budget = -1;
    const summary = await runMorning({ inviteXp,
      holds: async () => {
        now += 40_000;
        return {} as never;
      },
      campaigns,
      emails,
      weekly: async (budgetMs) => {
        order.push("weekly");
        now += Math.min(budgetMs, 6_000);
        return { week: null, sent: 0, empty: 0, notSent: 0, deferred: 0 };
      },
      listings: async (budgetMs) => {
        order.push("listings");
        budget = budgetMs;
        now += budgetMs;
        return { observed: "new" as const, detected: 3, sending: { announcement: "a1", switchOn: true, sent: 3, notSent: 0, deferred: 1, finished: false } };
      },
      budgetAlerts: async () => {
        order.push("alerts");
        return { low: 0, sent: 0, already: 0, failed: 0 };
      },
      budgets: { holds: 1_000, emails: 1_000, weekly: 10_000, run: 57_000 },
      clock: () => now,
    });
    expect(order).toEqual(["weekly", "listings", "alerts"]);
    // 11s left after the weekly stage: the budget alerts keep their 4s.
    expect(budget).toBe(7_000);
    expect(summary.listings).toEqual({ ok: true, result: { observed: "new", detected: 3, sending: { announcement: "a1", switchOn: true, sent: 3, notSent: 0, deferred: 1, finished: false } } });
    expect(summary.failed).toBe(false);
  });

  it("reports a New stocks stage that throws without failing the run", async () => {
    const summary = await runMorning({ inviteXp, holds, campaigns, emails, weekly: async () => ({ week: null, sent: 0, empty: 0, notSent: 0, deferred: 0 }), listings: async () => Promise.reject(new Error("db down")), budgets });
    expect(summary.listings).toEqual({ ok: false, error: "db down" });
    expect(summary.failed).toBe(false);
  });

  it("reports the weekly summary's own result", async () => {
    const summary = await runMorning({ inviteXp, listings,
      holds,
      campaigns,
      emails,
      weekly: async () => ({ week: "2026-W39", sent: 2, empty: 0, notSent: 0, deferred: 0 }),
      budgets,
    });
    expect(summary.weekly).toEqual({ ok: true, result: { week: "2026-W39", sent: 2, empty: 0, notSent: 0, deferred: 0 } });
    expect(summary.failed).toBe(false);
  });

  it("runs the invite XP step after the campaign step and before the emails, and a failing one fails nothing", async () => {
    const order: string[] = [];
    const summary = await runMorning({
      listings,
      holds,
      campaigns: async () => {
        order.push("campaigns");
        return campaigns();
      },
      inviteXp: async () => {
        order.push("inviteXp");
        throw new Error("db down");
      },
      emails: async () => {
        order.push("emails");
        return emails();
      },
      weekly: async () => ({ week: null, sent: 0, empty: 0, notSent: 0, deferred: 0 }),
      budgets,
    });
    expect(order).toEqual(["campaigns", "inviteXp", "emails"]);
    expect(summary.inviteXp).toEqual({ ok: false, error: "db down" });
    expect(summary.failed).toBe(false);
  });

  it("has no recurring stage: recurring buys were retired on 2026-10-04", async () => {
    const summary = await runMorning({ inviteXp, listings, holds, campaigns, emails, weekly: async () => ({ week: null, sent: 0, empty: 0, notSent: 0, deferred: 0 }), budgets });
    expect(summary).not.toHaveProperty("recurring");
  });

  it("reports a weekly stage that throws or overruns without failing the run", async () => {
    const thrown = await runMorning({ inviteXp, listings, holds,
      campaigns, emails, weekly: async () => Promise.reject(new Error("db down")), budgets });
    expect(thrown.weekly).toEqual({ ok: false, error: "db down" });
    expect(thrown.emails.ok).toBe(true);
    expect(thrown.failed).toBe(false);
    const slow = await runMorning({ inviteXp, listings, holds,
      campaigns, emails, weekly: () => new Promise(() => undefined), budgets });
    expect(slow.weekly).toEqual({ ok: false, error: "over its 50ms budget" });
    expect(slow.failed).toBe(false);
  });
});

describe("the morning's worst case", () => {
  it("does not start the weekly stage at all with no time left", async () => {
    let now = 0;
    let weeklyCalled = false;
    const summary = await runMorning({ inviteXp, listings,
      holds: async () => {
        now += 54_000;
        return { checked: 0, paid: 0, forfeited: 0, retried: 0 };
      },
      campaigns: async () => ({}) as never,
      emails: async () => ({ retried: 0, sent: 0, gaveUp: 0 }),
      weekly: async () => {
        weeklyCalled = true;
        return { week: null, sent: 0, empty: 0, notSent: 0, deferred: 0 };
      },
      budgetAlerts: async () => ({ low: 0, sent: 0, already: 0, failed: 0 }),
      budgets: { holds: 60_000, emails: 1_000, weekly: 10_000, run: 57_000 },
      clock: () => now,
    });
    expect(weeklyCalled).toBe(false);
    expect(summary.weekly).toEqual({ ok: false, error: "no time left" });
    expect(summary.failed).toBe(false);
  });
});
