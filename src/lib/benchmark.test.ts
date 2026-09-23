import { describe, expect, it } from "vitest";
import { combine, compareHolding, markAt, tradingDaysSince, type Marks, type OrderFacts } from "@/lib/benchmark";

const SPY: Marks = {
  dates: ["2026-09-17", "2026-09-18", "2026-09-21", "2026-09-22"],
  values: [700, 710, 720, 730],
};

const buy = (partial: Partial<OrderFacts>): OrderFacts => ({
  symbol: "NVDA",
  direction: "buy",
  quantity: 1,
  usd: 100,
  placedAt: "2026-09-21T15:00:00Z",
  ...partial,
});

describe("markAt", () => {
  it("uses the day's mark only once it has been stamped", () => {
    expect(markAt(SPY, "2026-09-21T15:00:00Z")).toBe(720);
    // 09:19 UTC is before the 12:50 mark: the Friday mark is the latest known.
    expect(markAt(SPY, "2026-09-21T09:19:00Z")).toBe(710);
  });

  it("has nothing to say before the first mark", () => {
    expect(markAt(SPY, "2026-09-01T15:00:00Z")).toBeUndefined();
  });
});

describe("compareHolding", () => {
  const base = { held: 1, priceNow: 110, benchmarkNow: 792, benchmarkMarks: SPY };

  it("compares the same dollars over the same days", () => {
    const result = compareHolding({ ...base, orders: [buy({})] });
    expect(result?.since).toBe("2026-09-21");
    expect(result?.paid).toBe(100);
    expect(result?.worth).toBe(110);
    expect(result?.changePct).toBeCloseTo(10);
    // 100 dollars at 720 is 0.1389 units, worth 110 at 792: also +10%.
    expect(result?.benchmarkChangePct).toBeCloseTo(10);
    expect(result?.tradingDays).toBe(1);
  });

  it("counts the session a pre-mark buy lived through", () => {
    const early = compareHolding({ ...base, orders: [buy({ placedAt: "2026-09-21T09:19:00Z" })] });
    // Measured from Friday's mark, so Monday's and Tuesday's marks both count.
    expect(early?.tradingDays).toBe(2);
  });

  it("puts each buy into the fund at its own day's price", () => {
    const result = compareHolding({
      ...base,
      held: 2,
      orders: [buy({ placedAt: "2026-09-17T15:00:00Z" }), buy({ placedAt: "2026-09-22T15:00:00Z" })],
    });
    // 100/700 + 100/730 units, at 792.
    expect(result?.benchmarkWorth).toBeCloseTo((100 / 700 + 100 / 730) * 792);
    expect(result?.since).toBe("2026-09-17");
  });

  it("refuses rather than guess", () => {
    expect(compareHolding({ ...base, orders: [buy({ usd: null })] })).toBeUndefined();
    expect(compareHolding({ ...base, orders: [buy({}), buy({ direction: "sell" })] })).toBeUndefined();
    // Holds twice what the orders bought: something came in that they cannot see.
    expect(compareHolding({ ...base, held: 2, orders: [buy({})] })).toBeUndefined();
    expect(compareHolding({ ...base, orders: [buy({ placedAt: "2026-09-01T00:00:00Z" })] })).toBeUndefined();
    expect(compareHolding({ ...base, priceNow: undefined, orders: [buy({})] })).toBeUndefined();
  });

  it("allows the rounding a balance picks up", () => {
    expect(compareHolding({ ...base, held: 1.004, orders: [buy({})] })).toBeDefined();
  });
});

describe("combine", () => {
  it("sums dollars and starts at the earliest buy", () => {
    const a = compareHolding({ held: 1, priceNow: 110, benchmarkNow: 792, benchmarkMarks: SPY, orders: [buy({})] })!;
    const b = compareHolding({
      held: 1,
      priceNow: 90,
      benchmarkNow: 792,
      benchmarkMarks: SPY,
      orders: [buy({ placedAt: "2026-09-17T15:00:00Z" })],
    })!;
    const all = combine([a, b])!;
    expect(all.paid).toBe(200);
    expect(all.worth).toBe(200);
    expect(all.changePct).toBeCloseTo(0);
    expect(all.since).toBe("2026-09-17");
  });

  it("is nothing for nothing", () => {
    expect(combine([])).toBeUndefined();
  });
});

describe("tradingDaysSince", () => {
  it("counts the marks after the one a buy was measured from", () => {
    expect(tradingDaysSince(SPY, "2026-09-17T15:00:00Z")).toBe(3);
    expect(tradingDaysSince(SPY, "2026-09-01T15:00:00Z")).toBe(0);
  });
});
