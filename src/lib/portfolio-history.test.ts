import { describe, expect, it } from "vitest";
import type { Marks, OrderFacts } from "@/lib/benchmark";
import {
  availableRanges,
  historyRanges,
  portfolioHistory,
  type HistoryInput,
  type PortfolioDay,
} from "@/lib/portfolio-history";

/**
 * The spec for the portfolio module's numbers. Days are September 2026:
 * Mon 14 to Fri 18, Mon 21 to Fri 25. A stored day's value is its close,
 * taken at 21:30 UTC (lib/marks); an order belongs to the first day whose
 * close comes after it.
 */

const marks = (byDay: Record<string, number>): Marks => {
  const dates = Object.keys(byDay).sort();
  return { dates, values: dates.map((day) => byDay[day]) };
};

const days = (byDay: Record<string, number>): PortfolioDay[] =>
  Object.keys(byDay)
    .sort()
    .map((day) => ({ day, value: byDay[day] }));

const buy = (placedAt: string, usd: number | null, quantity = 1, symbol = "NVDA"): OrderFacts => ({
  symbol,
  direction: "buy",
  quantity,
  usd,
  placedAt,
});

const sell = (placedAt: string, quantity: number | null, symbol = "NVDA"): OrderFacts => ({
  symbol,
  direction: "sell",
  quantity,
  usd: null,
  placedAt,
});

const SPY = marks({
  "2026-09-14": 50,
  "2026-09-15": 51,
  "2026-09-16": 52,
  "2026-09-17": 49,
  "2026-09-18": 50,
  "2026-09-21": 51,
  "2026-09-22": 52,
  "2026-09-23": 53,
  "2026-09-24": 54,
});

describe("one buy, held", () => {
  const input: HistoryInput = {
    days: days({ "2026-09-15": 100, "2026-09-16": 110, "2026-09-17": 99 }),
    orders: [buy("2026-09-15T15:00:00Z", 100)],
    benchmarkMarks: SPY,
  };

  it("draws both lines in dollars from the first day, the benchmark bought at the close before the order", () => {
    const result = portfolioHistory(input, "since");
    // 100 dollars at Monday's close of 50 is 2 units of the fund.
    expect(result.days).toEqual([
      { day: "2026-09-15", value: 100, benchmark: 102 },
      { day: "2026-09-16", value: 110, benchmark: 104 },
      { day: "2026-09-17", value: 99, benchmark: 98 },
    ]);
    expect(result.since).toBe("2026-09-15");
    expect(result.benchmarkStatus).toBe("ok");
  });

  it("chains the daily returns into the change, and measures the benchmark's own change over the same days", () => {
    const result = portfolioHistory(input, "since");
    expect(result.changePct).toBeCloseTo(-1, 10);
    expect(result.benchmarkPct).toBeCloseTo((49 / 51 - 1) * 100, 10);
    expect(result.tradingDays).toBe(2);
  });

  it("measures an order placed after the close against that close, and counts it from the next day", () => {
    const late: HistoryInput = {
      days: days({ "2026-09-15": 0, "2026-09-16": 104, "2026-09-17": 100 }),
      orders: [buy("2026-09-15T22:00:00Z", 102)],
      benchmarkMarks: SPY,
    };
    const result = portfolioHistory(late, "since");
    // Tuesday's close (51) is the last one before the order: 2 units.
    expect(result.days[0]).toEqual({ day: "2026-09-16", value: 104, benchmark: 104 });
    expect(result.since).toBe("2026-09-16");
  });
});

describe("money added and taken out", () => {
  it("moves both lines together on a deposit, and keeps the deposit out of the change", () => {
    const result = portfolioHistory(
      {
        days: days({ "2026-09-15": 100, "2026-09-16": 205, "2026-09-17": 210 }),
        orders: [buy("2026-09-15T15:00:00Z", 100), buy("2026-09-16T15:00:00Z", 100)],
        benchmarkMarks: SPY,
      },
      "since",
    );
    const units = 2 + 100 / 51;
    expect(result.days[1].benchmark).toBeCloseTo(units * 52, 10);
    expect(result.days[2].benchmark).toBeCloseTo(units * 49, 10);
    // 205 on 200 invested, then 210 on 205: five percent, not a hundred.
    expect(result.changePct).toBeCloseTo(5, 10);
  });

  it("sells the same share of the benchmark as of the listing, and values the proceeds at that day's close", () => {
    const result = portfolioHistory(
      {
        days: days({ "2026-09-15": 100, "2026-09-16": 57, "2026-09-17": 60 }),
        orders: [buy("2026-09-15T15:00:00Z", 100, 10), sell("2026-09-16T15:00:00Z", 5)],
        benchmarkMarks: SPY,
        listingCloses: { NVDA: marks({ "2026-09-16": 11 }) },
      },
      "since",
    );
    // Half the NVDA sold: half of the 2 fund units go with it.
    expect(result.days[1].benchmark).toBeCloseTo(52, 10);
    expect(result.days[2].benchmark).toBeCloseTo(49, 10);
    // Proceeds 5 x 11 = 55 leave: 57 on 45, then 60 on 57.
    expect(result.changePct).toBeCloseTo(((57 / 45) * (60 / 57) - 1) * 100, 10);
  });
});

describe("refusing rather than guessing", () => {
  it("draws no benchmark when a buy has no dollar cost", () => {
    const result = portfolioHistory(
      {
        days: days({ "2026-09-15": 100, "2026-09-16": 110 }),
        orders: [buy("2026-09-15T15:00:00Z", null)],
        benchmarkMarks: SPY,
      },
      "since",
    );
    expect(result.benchmarkStatus).toBe("unpriced_orders");
    expect(result.days.every((point) => point.benchmark === null)).toBe(true);
    // The change needs no dollars for the first buy: it is the base.
    expect(result.changePct).toBeCloseTo(10, 10);
  });

  it("refuses a sell with no quantity, and a sell of more than the orders bought", () => {
    const base = {
      days: days({ "2026-09-15": 100, "2026-09-16": 50 }),
      benchmarkMarks: SPY,
      listingCloses: { NVDA: marks({ "2026-09-16": 10 }) },
    };
    expect(
      portfolioHistory(
        { ...base, orders: [buy("2026-09-15T15:00:00Z", 100, 10), sell("2026-09-16T15:00:00Z", null)] },
        "since",
      ).benchmarkStatus,
    ).toBe("unpriced_orders");
    expect(
      portfolioHistory(
        { ...base, orders: [buy("2026-09-15T15:00:00Z", 100, 10), sell("2026-09-16T15:00:00Z", 20)] },
        "since",
      ).benchmarkStatus,
    ).toBe("unpriced_orders");
  });

  it("gives no change when money moved on a day it cannot value", () => {
    const result = portfolioHistory(
      {
        days: days({ "2026-09-15": 100, "2026-09-16": 210 }),
        orders: [buy("2026-09-15T15:00:00Z", 100), buy("2026-09-16T15:00:00Z", null)],
        benchmarkMarks: SPY,
      },
      "since",
    );
    expect(result.changePct).toBeNull();
    expect(result.benchmarkStatus).toBe("unpriced_orders");
  });

  it("says no_marks when the benchmark has no close before a buy", () => {
    const result = portfolioHistory(
      {
        days: days({ "2026-09-15": 100, "2026-09-16": 110 }),
        orders: [buy("2026-09-15T15:00:00Z", 100)],
        benchmarkMarks: { dates: [], values: [] },
      },
      "since",
    );
    expect(result.benchmarkStatus).toBe("no_marks");
    expect(result.benchmarkPct).toBeNull();
    expect(result.days.every((point) => point.benchmark === null)).toBe(true);
    expect(result.changePct).toBeCloseTo(10, 10);
  });

  it("leaves a day the benchmark has no close for as a gap, never a copy of the day before", () => {
    const gappy = marks({ "2026-09-14": 50, "2026-09-15": 51, "2026-09-17": 49 });
    const result = portfolioHistory(
      {
        days: days({ "2026-09-15": 100, "2026-09-16": 110, "2026-09-17": 99 }),
        orders: [buy("2026-09-15T15:00:00Z", 100)],
        benchmarkMarks: gappy,
      },
      "since",
    );
    expect(result.days.map((point) => point.benchmark)).toEqual([102, null, 98]);
    expect(result.benchmarkStatus).toBe("ok");
  });

  it("is too_short with fewer than two days", () => {
    const result = portfolioHistory(
      {
        days: days({ "2026-09-15": 100 }),
        orders: [buy("2026-09-15T15:00:00Z", 100)],
        benchmarkMarks: SPY,
      },
      "since",
    );
    expect(result.benchmarkStatus).toBe("too_short");
    expect(result.changePct).toBeNull();
    expect(result.tradingDays).toBe(0);
  });
});

describe("windows", () => {
  const long: HistoryInput = {
    days: days({
      "2026-09-14": 100,
      "2026-09-15": 101,
      "2026-09-16": 102,
      "2026-09-17": 103,
      "2026-09-18": 104,
      "2026-09-21": 105,
      "2026-09-22": 106,
      "2026-09-23": 107,
      "2026-09-24": 108,
    }),
    orders: [buy("2026-09-14T15:00:00Z", 100)],
    benchmarkMarks: marks({ "2026-09-11": 50, ...Object.fromEntries(SPY.dates.map((d, i) => [d, SPY.values[i]])) }),
  };

  it("starts a week back from the last day, and keeps the benchmark as it stands rather than restarting it", () => {
    const result = portfolioHistory(long, "1w");
    expect(result.since).toBe("2026-09-17");
    expect(result.days.map((point) => point.day)).toEqual([
      "2026-09-17",
      "2026-09-18",
      "2026-09-21",
      "2026-09-22",
      "2026-09-23",
      "2026-09-24",
    ]);
    // 100 dollars at Friday 11's close of 50: 2 units, valued at 49 on the 17th.
    expect(result.days[0].benchmark).toBe(98);
    expect(result.changePct).toBeCloseTo((108 / 103 - 1) * 100, 10);
    expect(result.benchmarkPct).toBeCloseTo((54 / 49 - 1) * 100, 10);
    expect(result.tradingDays).toBe(5);
  });

  it("starts at the first day with a value when the range reaches further back", () => {
    const result = portfolioHistory(long, "1m");
    expect(result.since).toBe("2026-09-14");
    expect(result.days).toHaveLength(9);
  });

  it("offers a fixed range only when the data fills it, and since first buy whenever there are two days", () => {
    expect(availableRanges(long)).toEqual(["1w", "since"]);
    expect(availableRanges({ ...long, days: long.days.slice(0, 2) })).toEqual(["since"]);
    expect(availableRanges({ ...long, days: long.days.slice(0, 1) })).toEqual([]);

    const fromJune: HistoryInput = {
      ...long,
      days: [{ day: "2026-06-24", value: 90 }, ...long.days],
      orders: [buy("2026-06-24T15:00:00Z", 90)],
    };
    // Three months back from the 24th is June 24: filled, just.
    expect(availableRanges(fromJune)).toEqual(["1w", "1m", "3m", "since"]);
    const fromLateJune = { ...fromJune, days: [{ day: "2026-06-26", value: 90 }, ...long.days] };
    expect(availableRanges(fromLateJune)).toEqual(["1w", "1m", "since"]);
  });

  it("offers all only when there is value from before the first buy", () => {
    const transferredIn: HistoryInput = {
      ...long,
      orders: [buy("2026-09-21T15:00:00Z", 1)],
    };
    expect(availableRanges(transferredIn)).toEqual(["1w", "since", "all"]);
    expect(portfolioHistory(transferredIn, "since").since).toBe("2026-09-21");
    expect(portfolioHistory(transferredIn, "all").since).toBe("2026-09-14");
  });
});

describe("today, live", () => {
  const input: HistoryInput = {
    days: days({ "2026-09-23": 100, "2026-09-24": 110 }),
    orders: [buy("2026-09-22T15:00:00Z", 100)],
    benchmarkMarks: SPY,
  };

  it("ends both lines on today's live values", () => {
    const result = portfolioHistory(
      { ...input, live: { day: "2026-09-25", asOf: "2026-09-25T15:00:00Z", value: 120, benchmarkPrice: 55 } },
      "since",
    );
    // 100 dollars at Monday 21's close of 51.
    const units = 100 / 51;
    expect(result.days.at(-1)).toEqual({ day: "2026-09-25", value: 120, benchmark: units * 55 });
    expect(result.benchmarkPct).toBeCloseTo((55 / 53 - 1) * 100, 10);
    expect(result.changePct).toBeCloseTo(20, 10);
  });

  it("replaces today's stored close with the live value, and uses the latest mark when there is no live benchmark price", () => {
    const result = portfolioHistory(
      { ...input, live: { day: "2026-09-24", asOf: "2026-09-24T22:00:00Z", value: 111, benchmarkPrice: null } },
      "since",
    );
    expect(result.days).toHaveLength(2);
    expect(result.days[1]).toEqual({ day: "2026-09-24", value: 111, benchmark: (100 / 51) * 54 });
  });

  it("counts an order placed today in today's live point", () => {
    const result = portfolioHistory(
      {
        ...input,
        orders: [...input.orders, buy("2026-09-25T14:00:00Z", 50)],
        live: { day: "2026-09-25", asOf: "2026-09-25T15:00:00Z", value: 165, benchmarkPrice: 54 },
      },
      "since",
    );
    const units = 100 / 51 + 50 / 54;
    expect(result.days.at(-1)?.benchmark).toBeCloseTo(units * 54, 10);
    // 110, then 165 on 160 invested.
    expect(result.changePct).toBeCloseTo(((110 / 100) * (165 / 160) - 1) * 100, 10);
  });
});

describe("historyRanges", () => {
  it("computes what is offered, and since first buy even on the first day", () => {
    const first = historyRanges({
      days: days({ "2026-09-24": 100 }),
      orders: [buy("2026-09-24T15:00:00Z", 100)],
      benchmarkMarks: SPY,
    });
    expect(first.available).toEqual([]);
    expect(Object.keys(first.ranges)).toEqual(["since"]);
    expect(first.ranges.since?.benchmarkStatus).toBe("too_short");
  });
});
