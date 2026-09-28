import { describe, expect, it } from "vitest";
import { CHAT_UNLOCK_LEVEL } from "@/lib/xp";
import {
  CHAT_LIMITS,
  budgetOpen,
  chatWindows,
  dailyAllowance,
  dayStart,
  monthStart,
  monthlyBudgetMicros,
  monthlyShareMicros,
  refusalFor,
} from "./limits";
import { costMicros } from "./prices";
import { chatAvailability, chatEnabled } from "./config";

describe("the day's allowance", () => {
  it("is nothing below the chat rung", () => {
    expect(dailyAllowance(CHAT_UNLOCK_LEVEL - 1)).toBeNull();
    expect(dailyAllowance(0)).toBeNull();
  });

  it("grows with rank", () => {
    expect(dailyAllowance(2)).toEqual({ messages: 25, costMicros: 100_000 });
    expect(dailyAllowance(4)).toEqual({ messages: 25, costMicros: 100_000 });
    expect(dailyAllowance(5)).toEqual({ messages: 50, costMicros: 200_000 });
    expect(dailyAllowance(8)).toEqual({ messages: 100, costMicros: 400_000 });
    expect(dailyAllowance(10)).toEqual({ messages: 100, costMicros: 400_000 });
  });

  it("cannot be outspent by a whole day of heavy Luna turns at the base rank", () => {
    // A heavy turn: four steps, ~30k input tokens mostly cached, 2k output with reasoning.
    const heavy = costMicros("gpt-6-luna", { input: 30_000, cacheRead: 24_000, cacheWrite: 0, output: 2_000 });
    expect(heavy).toBeLessThan(2_000);
    expect(heavy * 25).toBeLessThan(dailyAllowance(2)!.costMicros);
  });
});

describe("refusalFor", () => {
  const allowance = { messages: 25, costMicros: 100_000 };

  it("lets a message within every limit go", () => {
    expect(refusalFor({ allowance, costTodayMicros: 0, minute: 1, day: 1 })).toBeNull();
    expect(refusalFor({ allowance, costTodayMicros: 99_999, minute: CHAT_LIMITS.perMinute, day: 25 })).toBeNull();
  });

  it("closes the day on messages or on cost, whichever runs out first", () => {
    expect(refusalFor({ allowance, costTodayMicros: 0, minute: 1, day: 26 })).toBe("limit_day");
    expect(refusalFor({ allowance, costTodayMicros: 100_000, minute: 1, day: 2 })).toBe("limit_day");
  });

  it("holds the minute without spending the day", () => {
    expect(refusalFor({ allowance, costTodayMicros: 0, minute: CHAT_LIMITS.perMinute + 1, day: null })).toBe("limit_minute");
  });
});

describe("the house budget", () => {
  it("defaults to $5 and reads CHAT_MONTHLY_BUDGET_USD", () => {
    expect(monthlyBudgetMicros(undefined)).toBe(5_000_000);
    expect(monthlyBudgetMicros("")).toBe(5_000_000);
    expect(monthlyBudgetMicros("12.5")).toBe(12_500_000);
    expect(monthlyBudgetMicros("0")).toBe(0);
    expect(monthlyBudgetMicros("lots")).toBe(5_000_000);
    expect(monthlyBudgetMicros("-3")).toBe(5_000_000);
  });

  it("gives one person at most $0.50 of it a month, and never more than the budget", () => {
    expect(monthlyShareMicros(5_000_000)).toBe(500_000);
    expect(monthlyShareMicros(200_000)).toBe(200_000);
  });

  it("closes at 100%", () => {
    expect(budgetOpen(4_999_999, 5_000_000)).toBe(true);
    expect(budgetOpen(5_000_000, 5_000_000)).toBe(false);
    expect(budgetOpen(0, 0)).toBe(false);
  });
});

describe("windows", () => {
  it("count per UTC minute and day, per person", () => {
    const now = new Date("2026-09-28T17:42:31.500Z");
    expect(chatWindows("u1", now)).toEqual({
      minute: ["chat:minute:u1", "2026-09-28T17:42:00.000Z"],
      day: ["chat:day:u1", "2026-09-28T00:00:00.000Z"],
    });
    expect(dayStart(now).toISOString()).toBe("2026-09-28T00:00:00.000Z");
    expect(monthStart(now).toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });
});

describe("costMicros", () => {
  it("prices Luna's tokens in USD millionths: fresh, cached, written and output", () => {
    // 1M fresh input = $0.10; 1M cached = $0.01; 1M output = $0.50.
    expect(costMicros("gpt-6-luna", { input: 1_000_000, cacheRead: 0, cacheWrite: 0, output: 0 })).toBe(100_000);
    expect(costMicros("gpt-6-luna", { input: 1_000_000, cacheRead: 1_000_000, cacheWrite: 0, output: 0 })).toBe(10_000);
    expect(costMicros("gpt-6-luna", { input: 0, cacheRead: 0, cacheWrite: 0, output: 1_000_000 })).toBe(500_000);
    expect(costMicros("gpt-6-luna", { input: 2_000, cacheRead: 0, cacheWrite: 2_000, output: 0 })).toBe(250);
  });

  it("rounds up, never down, and is free only for the mock", () => {
    expect(costMicros("gpt-6-luna", { input: 3, cacheRead: 0, cacheWrite: 0, output: 0 })).toBe(1);
    expect(costMicros("mock", { input: 10_000, cacheRead: 0, cacheWrite: 0, output: 10_000 })).toBe(0);
    expect(costMicros("something-new", { input: 1_000, cacheRead: 0, cacheWrite: 0, output: 0 })).toBeGreaterThan(0);
  });
});

describe("chatAvailability", () => {
  it("needs the key, and is on by default", () => {
    expect(chatAvailability({ OPENAI_API_KEY: "k" })).toEqual({ ok: true, provider: { kind: "openai", model: "gpt-6-luna" } });
    expect(chatAvailability({})).toEqual({ ok: false, code: "unavailable" });
    expect(chatAvailability({ OPENAI_API_KEY: "  " })).toEqual({ ok: false, code: "unavailable" });
  });

  it("turns off with CHAT_ENABLED", () => {
    for (const off of ["0", "false", "OFF"]) expect(chatAvailability({ OPENAI_API_KEY: "k", CHAT_ENABLED: off })).toEqual({ ok: false, code: "disabled" });
    expect(chatEnabled({ CHAT_ENABLED: "1" })).toBe(true);
  });

  it("offers the mock in development only", () => {
    expect(chatAvailability({ CHAT_PROVIDER: "mock", NODE_ENV: "development" })).toEqual({ ok: true, provider: { kind: "mock", model: "mock" } });
    expect(chatAvailability({ CHAT_PROVIDER: "mock", NODE_ENV: "production" })).toEqual({ ok: false, code: "unavailable" });
    expect(chatAvailability({ CHAT_PROVIDER: "mock", NODE_ENV: "production", OPENAI_API_KEY: "k" })).toMatchObject({ provider: { kind: "openai" } });
  });
});
