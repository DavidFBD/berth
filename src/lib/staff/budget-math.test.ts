import { describe, expect, it } from "vitest";
import { alertRef, anyLow, daysToMonthEnd, defaultThreshold, meterStatus, parseAmount } from "./budget-math";

const NOW = new Date("2026-10-11T12:00:00Z");

describe("budget math", () => {
  it("takes a prepaid credit down by what was metered since it was read", () => {
    const status = meterStatus({ kind: "prepaid", unit: "usd", today: 0.1, month: 0.9, last7: 0.7, balance: 5, sinceBalance: 1.5 }, NOW);
    expect(status.remaining).toBeCloseTo(3.5);
    expect(status.burnPerDay).toBeCloseTo(0.1);
    expect(status.daysLeft).toBeCloseTo(35);
    expect(status.low).toBe(false);
    expect(status.estimate).toBe(true);
  });

  it("is unknown, never low, with no balance entered", () => {
    const status = meterStatus({ kind: "prepaid", unit: "usd", today: 1, month: 1, last7: 7, balance: null }, NOW);
    expect(status).toMatchObject({ remaining: null, daysLeft: null, low: false });
  });

  it("is low at or under its threshold", () => {
    expect(meterStatus({ kind: "prepaid", unit: "usd", today: 0, month: 0, last7: 0, balance: 1, sinceBalance: 0 }, NOW)).toMatchObject({ low: true, why: "threshold", threshold: 1 });
    expect(meterStatus({ kind: "prepaid", unit: "usd", today: 0, month: 0, last7: 0, balance: 3, sinceBalance: 0, threshold: 3 }, NOW)).toMatchObject({ low: true, why: "threshold" });
    expect(meterStatus({ kind: "prepaid", unit: "usd", today: 0, month: 0, last7: 0, balance: 3, sinceBalance: 0, threshold: 2 }, NOW).low).toBe(false);
  });

  it("is low when the pace runs it out within seven days", () => {
    // $10 left, $2 a day: five days.
    const status = meterStatus({ kind: "prepaid", unit: "usd", today: 2, month: 20, last7: 14, balance: 30, sinceBalance: 20, threshold: 0 }, NOW);
    expect(status.daysLeft).toBeCloseTo(5);
    expect(status).toMatchObject({ low: true, why: "runway" });
  });

  it("does not call a monthly budget low when the 1st comes first", () => {
    const lateMonth = new Date("2026-10-29T00:00:00Z"); // three days to the 1st
    // $5 budget, $3 spent, $0.50 a day: four days left, but the month ends in three.
    const fine = meterStatus({ kind: "monthly", unit: "usd", today: 0.5, month: 3, last7: 3.5, limit: 5, threshold: 0 }, lateMonth);
    expect(fine.daysLeft).toBeCloseTo(4);
    expect(fine.resetsInDays).toBeCloseTo(3);
    expect(fine.low).toBe(false);
    const early = meterStatus({ kind: "monthly", unit: "usd", today: 0.5, month: 3, last7: 3.5, limit: 5, threshold: 0 }, NOW);
    expect(early).toMatchObject({ low: true, why: "runway" });
  });

  it("uses a fifth of a monthly budget and a tenth of a quota as default thresholds", () => {
    expect(defaultThreshold({ kind: "monthly", unit: "usd", limit: 5 })).toBe(1);
    expect(defaultThreshold({ kind: "monthly", unit: "emails", limit: 3000 })).toBe(300);
    expect(meterStatus({ kind: "monthly", unit: "emails", today: 10, month: 2750, last7: 0, limit: 3000 }, NOW)).toMatchObject({ remaining: 250, low: true });
  });

  it("never alerts on a daily guard rail", () => {
    const status = meterStatus({ kind: "daily", unit: "posts", today: 50, month: 300, last7: 350, limit: 50 }, NOW);
    expect(status).toMatchObject({ remaining: 0, low: false });
    expect(anyLow([status])).toBe(false);
  });

  it("keys an alert once per service, admin and UTC day", () => {
    expect(alertRef("jev", "a", NOW)).toBe("jev:2026-10-11:a");
    expect(alertRef("jev", "a", new Date("2026-10-11T23:59:00Z"))).toBe(alertRef("jev", "a", NOW));
    expect(alertRef("jev", "a", new Date("2026-10-12T00:00:00Z"))).not.toBe(alertRef("jev", "a", NOW));
  });

  it("reads typed amounts", () => {
    expect(parseAmount("$1,250.50")).toBe(1250.5);
    expect(parseAmount("0")).toBe(0);
    expect(parseAmount("-1")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("")).toBeNull();
    expect(daysToMonthEnd(new Date("2026-10-31T12:00:00Z"))).toBeCloseTo(0.5);
  });
});
