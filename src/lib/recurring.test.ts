import { describe, expect, it } from "vitest";
import {
  PLAN_RESUME_MS,
  RECURRING_ID,
  checkPlan,
  dipExpiry,
  dipPrice,
  dueAfter,
  dueDayWords,
  dueForMorning,
  firstDueAt,
  localDate,
  nextRunStatus,
  ordinal,
  orderMatchesRun,
  planDraftUrl,
  readPlanParams,
  resumeLeft,
  runDraftUrl,
  startOfLocalDay,
  type PlanSchedule,
} from "./recurring";

const iso = (ms: number) => new Date(ms).toISOString();
const weekly = (weekday: number, timeZone: string): PlanSchedule => ({ cadence: "weekly", weekday, monthDay: null, timeZone });
const monthly = (monthDay: number, timeZone: string): PlanSchedule => ({ cadence: "monthly", weekday: null, monthDay, timeZone });

describe("the start of a local day", () => {
  it("is local midnight, in summer and in winter", () => {
    expect(iso(startOfLocalDay({ year: 2026, month: 10, day: 5 }, "Europe/Amsterdam"))).toBe("2026-10-04T22:00:00.000Z");
    expect(iso(startOfLocalDay({ year: 2026, month: 11, day: 2 }, "Europe/Amsterdam"))).toBe("2026-11-01T23:00:00.000Z");
    expect(iso(startOfLocalDay({ year: 2026, month: 10, day: 5 }, "America/New_York"))).toBe("2026-10-05T04:00:00.000Z");
    expect(iso(startOfLocalDay({ year: 2026, month: 11, day: 2 }, "America/New_York"))).toBe("2026-11-02T05:00:00.000Z");
    expect(iso(startOfLocalDay({ year: 2026, month: 10, day: 5 }, "Asia/Tokyo"))).toBe("2026-10-04T15:00:00.000Z");
    expect(iso(startOfLocalDay({ year: 2026, month: 10, day: 5 }, "Asia/Kathmandu"))).toBe("2026-10-04T18:15:00.000Z");
    expect(iso(startOfLocalDay({ year: 2026, month: 10, day: 5 }, "UTC"))).toBe("2026-10-05T00:00:00.000Z");
  });

  it("on the day the clocks change", () => {
    // Amsterdam falls back at 03:00 on 25 October: midnight is still summer time.
    expect(iso(startOfLocalDay({ year: 2026, month: 10, day: 25 }, "Europe/Amsterdam"))).toBe("2026-10-24T22:00:00.000Z");
    expect(iso(startOfLocalDay({ year: 2026, month: 10, day: 26 }, "Europe/Amsterdam"))).toBe("2026-10-25T23:00:00.000Z");
    // New York springs forward at 02:00 on 8 March.
    expect(iso(startOfLocalDay({ year: 2026, month: 3, day: 8 }, "America/New_York"))).toBe("2026-03-08T05:00:00.000Z");
    expect(iso(startOfLocalDay({ year: 2026, month: 3, day: 9 }, "America/New_York"))).toBe("2026-03-09T04:00:00.000Z");
  });

  it("where the clocks skip midnight itself, the day's first moment", () => {
    // Santiago springs forward at 00:00 on 6 September 2026: the day starts at 01:00 local.
    const start = startOfLocalDay({ year: 2026, month: 9, day: 6 }, "America/Santiago");
    expect(localDate(start, "America/Santiago")).toEqual({ year: 2026, month: 9, day: 6 });
    expect(localDate(start - 1, "America/Santiago")).toEqual({ year: 2026, month: 9, day: 5 });
  });
});

describe("when a plan comes due", () => {
  // Wednesday 30 September 2026, 10:00 UTC.
  const now = Date.parse("2026-09-30T10:00:00Z");

  it("first due is the next day it names, never today", () => {
    expect(iso(firstDueAt(weekly(1, "Europe/Amsterdam"), now))).toBe("2026-10-04T22:00:00.000Z");
    // A Wednesday plan set on a Wednesday starts next week.
    expect(iso(firstDueAt(weekly(3, "Europe/Amsterdam"), now))).toBe("2026-10-06T22:00:00.000Z");
    expect(iso(firstDueAt(monthly(1, "America/New_York"), now))).toBe("2026-10-01T04:00:00.000Z");
    expect(iso(firstDueAt(monthly(28, "America/New_York"), now))).toBe("2026-10-28T04:00:00.000Z");
  });

  it("reads today in the person's zone, not in UTC", () => {
    // 23:30 UTC on Wednesday is already Thursday in Tokyo: a Thursday plan starts next week there.
    const late = Date.parse("2026-09-30T23:30:00Z");
    expect(iso(firstDueAt(weekly(4, "Asia/Tokyo"), late))).toBe("2026-10-07T15:00:00.000Z");
    // Still Wednesday in Los Angeles: Thursday is tomorrow.
    expect(iso(firstDueAt(weekly(4, "America/Los_Angeles"), late))).toBe("2026-10-01T07:00:00.000Z");
  });

  it("steps week by week across a daylight saving change, staying at local midnight", () => {
    const schedule = weekly(1, "Europe/Amsterdam");
    const first = Date.parse("2026-10-18T22:00:00Z"); // Monday 19 October, summer time
    const second = dueAfter(schedule, first);
    expect(iso(second)).toBe("2026-10-25T23:00:00.000Z"); // Monday 26 October, winter time
    expect(iso(dueAfter(schedule, second))).toBe("2026-11-01T23:00:00.000Z");
    const ny = weekly(1, "America/New_York");
    expect(iso(dueAfter(ny, Date.parse("2026-10-26T04:00:00Z")))).toBe("2026-11-02T05:00:00.000Z");
    expect(iso(dueAfter(ny, Date.parse("2026-03-02T05:00:00Z")))).toBe("2026-03-09T04:00:00.000Z");
  });

  it("monthly on the 28th never skips February, and rolls over the year", () => {
    const schedule = monthly(28, "UTC");
    expect(iso(dueAfter(schedule, Date.parse("2027-01-28T00:00:00Z")))).toBe("2027-02-28T00:00:00.000Z");
    expect(iso(dueAfter(schedule, Date.parse("2027-02-28T00:00:00Z")))).toBe("2027-03-28T00:00:00.000Z");
    expect(iso(dueAfter(monthly(3, "UTC"), Date.parse("2026-12-03T00:00:00Z")))).toBe("2027-01-03T00:00:00.000Z");
  });

  it("the morning run takes a day that starts within its lookahead", () => {
    const morning = Date.parse("2026-10-05T06:10:00Z");
    expect(dueForMorning(Date.parse("2026-10-04T22:00:00Z"), morning)).toBe(true); // Amsterdam Monday
    expect(dueForMorning(Date.parse("2026-10-05T07:00:00Z"), morning)).toBe(true); // Los Angeles Monday
    expect(dueForMorning(Date.parse("2026-10-05T15:00:00Z"), morning)).toBe(false); // a day starting nine hours on
  });

  it("names the day in the plan's zone", () => {
    expect(dueDayWords("2026-10-04T22:00:00Z", "Europe/Amsterdam")).toBe("5 October");
    expect(ordinal(1)).toBe("1st");
    expect(ordinal(2)).toBe("2nd");
    expect(ordinal(3)).toBe("3rd");
    expect(ordinal(11)).toBe("11th");
    expect(ordinal(22)).toBe("22nd");
    expect(ordinal(28)).toBe("28th");
  });
});

describe("the run's life", () => {
  const due = Date.parse("2026-10-05T04:00:00Z");
  const day = 86_400_000;

  it("due, opened, then placed or skipped, and those are final", () => {
    expect(nextRunStatus("due", "open", due, due)).toBe("opened");
    expect(nextRunStatus("opened", "open", due, due)).toBeNull();
    expect(nextRunStatus("opened", "place", due, due)).toBe("placed");
    expect(nextRunStatus("due", "place", due, due)).toBe("placed");
    expect(nextRunStatus("due", "skip", due, due)).toBe("skipped");
    expect(nextRunStatus("placed", "skip", due, due)).toBeNull();
    expect(nextRunStatus("skipped", "place", due, due)).toBeNull();
    expect(nextRunStatus("placed", "age", due, due + 10 * day)).toBeNull();
  });

  it("ages into skipped after three days, not before", () => {
    expect(nextRunStatus("due", "age", due, due + 3 * day - 1)).toBeNull();
    expect(nextRunStatus("due", "age", due, due + 3 * day)).toBe("skipped");
    expect(nextRunStatus("opened", "age", due, due + 4 * day)).toBe("skipped");
  });

  it("an order is the run's when the listing, the dollars and the window match", () => {
    const run = { symbol: "NVDA", usd: 50, dueAt: due, createdAt: due - 2 * 3_600_000 };
    expect(orderMatchesRun(run, { symbol: "NVDA", usd: 49.2, at: due + day })).toBe(true);
    expect(orderMatchesRun(run, { symbol: "nvda", usd: 54.9, at: due })).toBe(true);
    expect(orderMatchesRun(run, { symbol: "NVDA", usd: 56, at: due })).toBe(false);
    expect(orderMatchesRun(run, { symbol: "TSLA", usd: 50, at: due })).toBe(false);
    expect(orderMatchesRun(run, { symbol: "NVDA", usd: null, at: due })).toBe(false);
    expect(orderMatchesRun(run, { symbol: "NVDA", usd: 50, at: due - 3 * 3_600_000 })).toBe(false);
    expect(orderMatchesRun(run, { symbol: "NVDA", usd: 50, at: due + 3 * day + 1 })).toBe(false);
  });
});

describe("checking a plan", () => {
  const base = { listing: "NVDA", usd: 20, cadence: "weekly" as const, weekday: 1, timeZone: "Europe/Amsterdam" };

  it("takes a sane plan", () => {
    const checked = checkPlan(base, { limitAllowed: false });
    expect(checked).toEqual({
      ok: true,
      plan: { symbol: "NVDA", usd: 20, schedule: weekly(1, "Europe/Amsterdam"), orderType: "market", dipPct: null },
    });
  });

  it("holds the limits: $1 to $10,000, a real day, a real zone, stocks only", () => {
    expect(checkPlan({ ...base, usd: 0.99 }, { limitAllowed: false })).toEqual({ ok: false, reason: "amount" });
    expect(checkPlan({ ...base, usd: 10_000 }, { limitAllowed: false }).ok).toBe(true);
    expect(checkPlan({ ...base, usd: 10_000.01 }, { limitAllowed: false })).toEqual({ ok: false, reason: "amount" });
    expect(checkPlan({ ...base, weekday: 7 }, { limitAllowed: false })).toEqual({ ok: false, reason: "day" });
    expect(checkPlan({ ...base, cadence: "monthly", monthDay: 29 }, { limitAllowed: false })).toEqual({ ok: false, reason: "day" });
    expect(checkPlan({ ...base, cadence: "monthly", monthDay: 28 }, { limitAllowed: false }).ok).toBe(true);
    expect(checkPlan({ ...base, timeZone: "Mars/Olympus" }, { limitAllowed: false })).toEqual({ ok: false, reason: "time_zone" });
    expect(checkPlan({ ...base, listing: "SGOV" }, { limitAllowed: false })).toEqual({ ok: false, reason: "listing" });
    expect(checkPlan({ ...base, listing: "ZZZZ" }, { limitAllowed: false })).toEqual({ ok: false, reason: "listing" });
  });

  it("buy on the dip only where limit orders are switched on", () => {
    expect(checkPlan({ ...base, orderType: "limit", dipPct: 5 }, { limitAllowed: false })).toEqual({ ok: false, reason: "limit_off" });
    expect(checkPlan({ ...base, orderType: "limit", dipPct: 0 }, { limitAllowed: true })).toEqual({ ok: false, reason: "dip" });
    const checked = checkPlan({ ...base, orderType: "limit", dipPct: 5 }, { limitAllowed: true });
    expect(checked.ok && checked.plan.dipPct).toBe(5);
  });

  it("the dip price and its expiry, the day before the next run", () => {
    expect(dipPrice(200, 5)).toBe(190);
    expect(dipPrice(undefined, 5)).toBeNull();
    expect(dipPrice(200, null)).toBeNull();
    expect(dipExpiry(weekly(1, "Europe/Amsterdam"), Date.parse("2026-10-04T22:00:00Z"))).toBe("2026-10-11");
  });
});

describe("the links", () => {
  it("a run opens the buy drawer with its amount and its id", () => {
    const url = runDraftUrl("https://www.berthmarkets.com", { id: "r1", symbol: "SPY", usd: 20, limitPrice: null });
    expect(url).toBe("https://www.berthmarkets.com/?open=SPY&side=buy&usd=20&run=r1");
  });

  it("a plan draft opens the plan sheet and reads back the same", () => {
    const url = planDraftUrl("https://www.berthmarkets.com", {
      symbol: "NVDA",
      usd: 50,
      schedule: monthly(15, "UTC"),
      dipPct: null,
    });
    expect(url).toBe("https://www.berthmarkets.com/?plan=NVDA&usd=50&every=monthly&day=15");
    expect(readPlanParams(new URL(url).searchParams)).toEqual({ symbol: "NVDA", usd: 50, cadence: "monthly", day: 15 });
    expect(readPlanParams(new URLSearchParams("open=NVDA"))).toBeNull();
  });
});

describe("the run's draft link reads back through the drawer's own reader", async () => {
  const { readDraftParams } = await import("./draft-order");
  it("carries the run id, a buy only, and only a real id", () => {
    const id = "0f8b9c1e-2d3a-4b5c-8d6e-7f8091a2b3c4";
    const url = new URL(runDraftUrl("https://www.berthmarkets.com", { id, symbol: "NVDA", usd: 50, limitPrice: 190, expires: "2026-10-11" }));
    expect(readDraftParams(url.searchParams)).toEqual({ symbol: "NVDA", side: "buy", usd: 50, limitPrice: 190, expires: "2026-10-11", runId: id });
    expect(readDraftParams(new URLSearchParams("open=NVDA&side=buy&run=../../x"))?.runId).toBeUndefined();
    expect(readDraftParams(new URLSearchParams(`open=NVDA&side=sell&run=${id}`))?.runId).toBeUndefined();
  });
});

describe("ids", () => {
  it("only a real uuid passes, not 36 hyphens", () => {
    expect(RECURRING_ID.test("3f2b8c1e-9a4d-4e2f-8b1a-2c3d4e5f6a7b")).toBe(true);
    expect(RECURRING_ID.test("-".repeat(36))).toBe(false);
    expect(RECURRING_ID.test("3f2b8c1e9a4d4e2f8b1a2c3d4e5f6a7b----")).toBe(false);
  });
});

describe("a plan draft kept across a sign in", () => {
  it("waits about half an hour, then lapses", () => {
    const since = Date.parse("2026-09-30T10:00:00Z");
    expect(PLAN_RESUME_MS).toBe(30 * 60_000);
    expect(resumeLeft(since, since)).toBe(PLAN_RESUME_MS);
    expect(resumeLeft(since, since + 29 * 60_000)).toBe(60_000);
    expect(resumeLeft(since, since + PLAN_RESUME_MS)).toBe(0);
    expect(resumeLeft(since, since + 5 * 3_600_000)).toBe(0);
  });
});
