import { describe, expect, it } from "vitest";
import { markAt, type Marks, type OrderFacts } from "@/lib/benchmark";
import { MARK_MINUTES, markAsOf } from "@/lib/marks";
import { ledgerDays } from "@/lib/portfolio-days";
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
 * close comes after it. Unless a test says otherwise, an order's recorded
 * S&P 500 fund price (its minute's, table order_marks) is the close before
 * it, which keeps the arithmetic readable.
 */

const marks = (byDay: Record<string, number>): Marks => {
  const dates = Object.keys(byDay).sort();
  return { dates, values: dates.map((day) => byDay[day]) };
};

const days = (byDay: Record<string, number>): PortfolioDay[] =>
  Object.keys(byDay)
    .sort()
    .map((day) => ({ day, value: byDay[day] }));

const buy = (
  placedAt: string,
  usd: number | null,
  quantity = 1,
  symbol = "NVDA",
  /** The fund's price at the order's minute; null for an order with none recorded. */
  spyAtOrder: number | null | undefined = markAt(SPY_BEFORE, placedAt, MARK_MINUTES),
): OrderFacts => ({
  symbol,
  direction: "buy",
  quantity,
  usd,
  placedAt,
  ...(spyAtOrder == null ? {} : { benchmarkMarks: { SPY: spyAtOrder } }),
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

/** The closes the default order price is looked up in: the S&P's, plus Friday the 11th. */
const SPY_BEFORE = marks({ "2026-09-11": 50, ...Object.fromEntries(SPY.dates.map((d, i) => [d, SPY.values[i]])) });

describe("one buy, held", () => {
  const input: HistoryInput = {
    days: days({ "2026-09-15": 100, "2026-09-16": 110, "2026-09-17": 99 }),
    orders: [buy("2026-09-15T15:00:00Z", 100)],
    benchmarkSymbol: "SPY",
        benchmarkMarks: SPY,
  };

  it("draws both lines in dollars from the first day, the benchmark bought at the close before the order", () => {
    const result = portfolioHistory(input, "since");
    // 100 dollars at Monday's close of 50 is 2 units of the fund.
    expect(result.days).toMatchObject([
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
    // Since first buy, the benchmark is measured from its price at the order (50).
    expect(result.benchmarkPct).toBeCloseTo((49 / 50 - 1) * 100, 10);
    expect(result.tradingDays).toBe(2);
  });

  it("measures an order placed after the close against that close, and counts it from the next day", () => {
    const late: HistoryInput = {
      days: days({ "2026-09-15": 0, "2026-09-16": 104, "2026-09-17": 100 }),
      orders: [buy("2026-09-15T22:00:00Z", 102)],
      benchmarkSymbol: "SPY",
        benchmarkMarks: SPY,
    };
    const result = portfolioHistory(late, "since");
    // Tuesday's close (51) is the last one before the order: 2 units.
    expect(result.days[0]).toMatchObject({ day: "2026-09-16", value: 104, benchmark: 104 });
    expect(result.since).toBe("2026-09-16");
  });
});

describe("money added and taken out", () => {
  it("moves both lines together on a deposit, and keeps the deposit out of the change", () => {
    const result = portfolioHistory(
      {
        days: days({ "2026-09-15": 100, "2026-09-16": 205, "2026-09-17": 210 }),
        orders: [buy("2026-09-15T15:00:00Z", 100), buy("2026-09-16T15:00:00Z", 100)],
        benchmarkSymbol: "SPY",
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

  it("sells the same share of the benchmark as of the listing, and counts the proceeds out at that day's close", () => {
    const result = portfolioHistory(
      {
        days: days({ "2026-09-15": 100, "2026-09-16": 57, "2026-09-17": 60 }),
        orders: [buy("2026-09-15T15:00:00Z", 100, 10), sell("2026-09-16T15:00:00Z", 5)],
        benchmarkSymbol: "SPY",
        benchmarkMarks: SPY,
        listingCloses: { NVDA: marks({ "2026-09-16": 11 }) },
      },
      "since",
    );
    // Half the NVDA sold: half of the 2 fund units go with it.
    expect(result.days[1].benchmark).toBeCloseTo(52, 10);
    expect(result.days[2].benchmark).toBeCloseTo(49, 10);
    // 100 paid, worth 100 at the close. Then 57 held plus 5 x 11 = 55 out,
    // on the 100 there was: +12%. Then 60 on 57.
    expect(result.changePct).toBeCloseTo((1.12 * (60 / 57) - 1) * 100, 10);
  });

  const nvda = (byDay: Record<string, number>) => ({ NVDA: marks(byDay) });

  it("reads a partial sell on an up day as the day's move, not more", () => {
    // 2 NVDA for 200 at 100; it closes at 110 and 1 is sold: +10%.
    const result = portfolioHistory(
      {
        days: days({ "2026-09-15": 200, "2026-09-16": 110 }),
        orders: [buy("2026-09-15T15:00:00Z", 200, 2), sell("2026-09-16T15:00:00Z", 1)],
        benchmarkSymbol: "SPY",
        benchmarkMarks: SPY,
        listingCloses: nvda({ "2026-09-15": 100, "2026-09-16": 110 }),
      },
      "since",
    );
    expect(result.changePct).toBeCloseTo(10, 10);
  });

  it("reads a ninety percent sell on a one percent day as one percent", () => {
    const result = portfolioHistory(
      {
        days: days({ "2026-09-15": 1000, "2026-09-16": 101 }),
        orders: [buy("2026-09-15T15:00:00Z", 1000, 10), sell("2026-09-16T15:00:00Z", 9)],
        benchmarkSymbol: "SPY",
        benchmarkMarks: SPY,
        listingCloses: nvda({ "2026-09-15": 100, "2026-09-16": 101 }),
      },
      "since",
    );
    expect(result.changePct).toBeCloseTo(1, 10);
  });

  it("keeps a full sell on a ten percent day at ten percent, and nothing held after moves nothing", () => {
    const result = portfolioHistory(
      {
        days: days({ "2026-09-15": 1000, "2026-09-16": 0, "2026-09-17": 0 }),
        orders: [buy("2026-09-15T15:00:00Z", 1000, 10), sell("2026-09-16T15:00:00Z", 10)],
        benchmarkSymbol: "SPY",
        benchmarkMarks: SPY,
        listingCloses: nvda({ "2026-09-15": 100, "2026-09-16": 110 }),
      },
      "since",
    );
    expect(result.changePct).toBeCloseTo(10, 10);
    expect(result.days.map((point) => point.benchmark)).toEqual([1020, 0, 0]);
  });

  it("gives no change when a sell lands on a day its listing has no close", () => {
    const result = portfolioHistory(
      {
        days: days({ "2026-09-15": 200, "2026-09-16": 110 }),
        orders: [buy("2026-09-15T15:00:00Z", 200, 2), sell("2026-09-16T15:00:00Z", 1)],
        benchmarkSymbol: "SPY",
        benchmarkMarks: SPY,
      },
      "since",
    );
    expect(result.changePct).toBeNull();
    expect(result.benchmarkStatus).toBe("ok");
  });
});

describe("since first buy starts from nothing", () => {
  it("counts the first day: 1,000 paid, 1,100 at the close, flat after, is ten percent", () => {
    const result = portfolioHistory(
      {
        days: days({ "2026-09-15": 1100, "2026-09-16": 1100, "2026-09-17": 1100 }),
        orders: [buy("2026-09-15T15:00:00Z", 1000, 10)],
        benchmarkSymbol: "SPY",
        benchmarkMarks: SPY,
      },
      "since",
    );
    expect(result.changePct).toBeCloseTo(10, 10);
  });

  it("counts the fee paid on the first day as a loss", () => {
    const result = portfolioHistory(
      {
        days: days({ "2026-09-15": 990, "2026-09-16": 990 }),
        orders: [buy("2026-09-15T15:00:00Z", 1000, 10)],
        benchmarkSymbol: "SPY",
        benchmarkMarks: SPY,
      },
      "since",
    );
    expect(result.changePct).toBeCloseTo(-1, 10);
  });

  it("keeps a fixed range's first close as its base", () => {
    const result = portfolioHistory(
      {
        days: days({ "2026-09-21": 1100, "2026-09-22": 1100, "2026-09-23": 1210 }),
        orders: [buy("2026-09-21T15:00:00Z", 1000, 10)],
        benchmarkSymbol: "SPY",
        benchmarkMarks: SPY,
      },
      "1w",
    );
    expect(result.since).toBe("2026-09-21");
    expect(result.changePct).toBeCloseTo(10, 10);
  });
});

describe("the benchmark bought at the order's minute", () => {
  it("buys the shadow at the price recorded for the order, and measures since first buy from it", () => {
    // Monday's close was 50, but the fund stood at 50.5 when the order was placed.
    const result = portfolioHistory(
      {
        days: days({ "2026-09-15": 100, "2026-09-16": 110 }),
        orders: [buy("2026-09-15T15:00:00Z", 101, 1, "NVDA", 50.5)],
        benchmarkSymbol: "SPY",
        benchmarkMarks: SPY,
      },
      "since",
    );
    // 101 dollars at 50.5 is 2 units.
    expect(result.days.map((point) => point.benchmark)).toEqual([102, 104]);
    expect(result.benchmarkPct).toBeCloseTo((52 / 50.5 - 1) * 100, 10);
    // The dollars and the percentage now agree: 104 on 101.
    expect(result.days[1].benchmark! / 101 - 1).toBeCloseTo(result.benchmarkPct! / 100, 10);
  });

  it("says no_marks when a buy has no price recorded for the benchmark, and still tells the change", () => {
    const result = portfolioHistory(
      {
        days: days({ "2026-09-15": 100, "2026-09-16": 110 }),
        orders: [buy("2026-09-15T15:00:00Z", 100, 1, "NVDA", null)],
        benchmarkSymbol: "SPY",
        benchmarkMarks: SPY,
      },
      "since",
    );
    expect(result.benchmarkStatus).toBe("no_marks");
    expect(result.benchmarkPct).toBeNull();
    expect(result.days.every((point) => point.benchmark === null)).toBe(true);
    expect(result.changePct).toBeCloseTo(10, 10);
  });

  it("reads the chosen benchmark's price from the order", () => {
    const btc = marks({ "2026-09-15": 1000, "2026-09-16": 1100 });
    const order = { ...buy("2026-09-15T15:00:00Z", 100), benchmarkMarks: { SPY: 50, BTC: 1000 } };
    const result = portfolioHistory(
      {
        days: days({ "2026-09-15": 100, "2026-09-16": 110 }),
        orders: [order],
        benchmarkSymbol: "BTC",
        benchmarkMarks: btc,
      },
      "since",
    );
    expect(result.days.map((point) => point.benchmark)).toEqual([100, 110]);
    expect(result.benchmarkPct).toBeCloseTo(10, 10);
  });
});

describe("refusing rather than guessing", () => {
  it("draws no benchmark and no change when the orders do not explain what is held", () => {
    const result = portfolioHistory(
      {
        days: days({ "2026-09-15": 100, "2026-09-16": 110 }),
        orders: [buy("2026-09-15T15:00:00Z", 100)],
        benchmarkSymbol: "SPY",
        benchmarkMarks: SPY,
        balanceExplained: false,
      },
      "since",
    );
    expect(result.benchmarkStatus).toBe("unexplained_balance");
    expect(result.days.map((point) => point.benchmark)).toEqual([null, null]);
    // A transfer in would read as a return: both percentages are withheld.
    expect(result.changePct).toBeNull();
    expect(result.benchmarkPct).toBeNull();
    // The dollars stay.
    expect(result.days.map((point) => point.value)).toEqual([100, 110]);
    expect(result.rebasedFrom).toBeNull();
  });

  it("draws no benchmark when a buy has no dollar cost", () => {
    const result = portfolioHistory(
      {
        days: days({ "2026-09-15": 100, "2026-09-16": 110 }),
        orders: [buy("2026-09-15T15:00:00Z", null)],
        benchmarkSymbol: "SPY",
        benchmarkMarks: SPY,
      },
      "since",
    );
    expect(result.benchmarkStatus).toBe("unpriced_orders");
    expect(result.days.every((point) => point.benchmark === null)).toBe(true);
    // An unpriced buy is money in of unknown size: no change either.
    expect(result.changePct).toBeNull();
    expect(result.benchmarkPct).toBeNull();
  });

  it("refuses a sell with no quantity, and a sell of more than the orders bought", () => {
    const base = {
      days: days({ "2026-09-15": 100, "2026-09-16": 50 }),
      benchmarkSymbol: "SPY",
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
        benchmarkSymbol: "SPY",
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
        benchmarkSymbol: "SPY",
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
        benchmarkSymbol: "SPY",
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
        benchmarkSymbol: "SPY",
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
    benchmarkSymbol: "SPY",
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
    benchmarkSymbol: "SPY",
        benchmarkMarks: SPY,
  };

  it("ends both lines on today's live values", () => {
    const result = portfolioHistory(
      { ...input, live: { day: "2026-09-25", asOf: "2026-09-25T15:00:00Z", value: 120, benchmarkPrice: 55 } },
      "since",
    );
    // 100 dollars at Monday 21's close of 51.
    const units = 100 / 51;
    expect(result.days.at(-1)).toMatchObject({ day: "2026-09-25", value: 120, benchmark: units * 55 });
    // Measured from the fund's price at the order, Monday 21's close of 51 here.
    expect(result.benchmarkPct).toBeCloseTo((55 / 51 - 1) * 100, 10);
    expect(result.changePct).toBeCloseTo(20, 10);
  });

  it("replaces today's stored close with the live value, and uses the latest mark when there is no live benchmark price", () => {
    const result = portfolioHistory(
      { ...input, live: { day: "2026-09-24", asOf: "2026-09-24T22:00:00Z", value: 111, benchmarkPrice: null } },
      "since",
    );
    expect(result.days).toHaveLength(2);
    expect(result.days[1]).toMatchObject({ day: "2026-09-24", value: 111, benchmark: (100 / 51) * 54 });
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
      benchmarkSymbol: "SPY",
        benchmarkMarks: SPY,
    });
    expect(first.available).toEqual([]);
    expect(Object.keys(first.ranges)).toEqual(["since"]);
    expect(first.ranges.since?.benchmarkStatus).toBe("too_short");
  });
});

describe("starting from a snapshot when money moved without an order", () => {
  // Two NVDA bought at 50 on the 15th; on the 16th one of them leaves the
  // account with no order, and the evening's snapshot holds one at 60.
  // Ten dollars buy a seventh of one on the 18th at 70.
  const base = {
    day: "2026-09-16",
    asOf: markAsOf("2026-09-16"),
    holdings: [{ symbol: "NVDA", quantity: 1, price: 60, source: "mark" as const }],
  };
  const input: HistoryInput = {
    days: days({ "2026-09-15": 100, "2026-09-16": 60, "2026-09-17": 66, "2026-09-18": 80 }),
    orders: [buy("2026-09-15T15:00:00Z", 100, 2), buy("2026-09-18T15:00:00Z", 10, 1 / 7)],
    benchmarkSymbol: "SPY",
    benchmarkMarks: SPY,
    balanceExplained: false,
    base,
  };

  it("buys the benchmark with the snapshot's value at that day's close, and counts only later orders", () => {
    const result = portfolioHistory(input, "since");
    expect(result.benchmarkStatus).toBe("ok");
    expect(result.rebasedFrom).toBe("2026-09-16");
    expect(result.since).toBe("2026-09-16");
    expect(result.days.map((point) => point.day)).toEqual(["2026-09-16", "2026-09-17", "2026-09-18"]);
    const units = 60 / 52;
    expect(result.days[0].benchmark).toBeCloseTo(60, 10);
    expect(result.days[1].benchmark).toBeCloseTo(units * 49, 10);
    // The 18th's buy takes the fund at its minute's price (the 17th's close, 49).
    expect(result.days[2].benchmark).toBeCloseTo((units + 10 / 49) * 50, 10);
    // Time weighted from the snapshot: 60 to 66, then 66 plus 10 in to 80.
    expect(result.changePct).toBeCloseTo((1.1 * (80 / 76) - 1) * 100, 10);
    expect(result.benchmarkPct).toBeCloseTo((50 / 52 - 1) * 100, 10);
  });

  it("offers no range that would reach back before the snapshot", () => {
    const { available, ranges } = historyRanges(input);
    expect(available).toEqual(["since"]);
    expect(portfolioHistory(input, "all").since).toBe("2026-09-16");
    expect(ranges.since?.rebasedFrom).toBe("2026-09-16");
  });

  it("ignores an unpriced order before the snapshot, and still refuses one after it", () => {
    const early = { ...input, orders: [buy("2026-09-15T15:00:00Z", null, 2), input.orders[1]] };
    expect(portfolioHistory(early, "since").benchmarkStatus).toBe("ok");
    const late = { ...input, orders: [input.orders[0], buy("2026-09-18T15:00:00Z", null, 1 / 7)] };
    const refused = portfolioHistory(late, "since");
    expect(refused.benchmarkStatus).toBe("unpriced_orders");
    expect(refused.changePct).toBeNull();
  });

  it("names the late start when the snapshot itself was worth nothing", () => {
    const empty = {
      ...input,
      days: days({ "2026-09-15": 100, "2026-09-16": 0, "2026-09-17": 10, "2026-09-18": 11 }),
      orders: [buy("2026-09-15T15:00:00Z", 100, 2), buy("2026-09-17T15:00:00Z", 10, 1)],
      base: { ...base, holdings: [] },
    };
    const result = portfolioHistory(empty, "since");
    expect(result.since).toBe("2026-09-17");
    expect(result.rebasedFrom).toBe("2026-09-17");
  });

  it("refuses when the snapshot's day has no benchmark close", () => {
    const gap = { ...input, benchmarkMarks: marks({ "2026-09-15": 51, "2026-09-17": 49, "2026-09-18": 50 }) };
    expect(portfolioHistory(gap, "since").benchmarkStatus).toBe("no_marks");
  });
});

describe("the join between days rebuilt from the orders and days read on chain", () => {
  // A buy on Tuesday the 15th; the evening snapshot starts on Friday the
  // 18th. Before it, days rebuilt from the orders (lib/portfolio-days
  // ledgerDays): valued at the close, as of the close. From it, snapshots:
  // the same holdings read on chain after the close, at the same closes.
  const NVDA = marks({ "2026-09-15": 100, "2026-09-16": 110, "2026-09-17": 99, "2026-09-18": 105, "2026-09-21": 108 });
  const firstBuy = buy("2026-09-15T15:00:00Z", 100);
  const rebuilt = (orders: OrderFacts[], through: string) =>
    ledgerDays({ orders, closes: { NVDA }, through }).map(({ day, value, asOf }) => ({ day, value, asOf }));
  const snapshot = (day: string, value: number): PortfolioDay => ({ day, value, asOf: `${day}T22:40:00.000Z` });
  const base = { benchmarkSymbol: "SPY", benchmarkMarks: SPY, listingCloses: { NVDA } };

  it("reads a join as the day's price move and nothing more: the same numbers as a line rebuilt all the way", () => {
    const joined = portfolioHistory(
      { ...base, orders: [firstBuy], days: [...rebuilt([firstBuy], "2026-09-17"), snapshot("2026-09-18", 105), snapshot("2026-09-21", 108)] },
      "since",
    );
    const allRebuilt = portfolioHistory({ ...base, orders: [firstBuy], days: rebuilt([firstBuy], "2026-09-21") }, "since");
    expect(joined.days).toEqual(allRebuilt.days);
    expect(joined.changePct).toBeCloseTo(8, 10);
    expect(joined.changePct).toBeCloseTo(allRebuilt.changePct!, 10);
    expect(joined.benchmarkPct).toBeCloseTo(allRebuilt.benchmarkPct!, 10);
    // 100 dollars at the fund's 50 (the close before the order) is 2 units, held across the join.
    expect(joined.days.map((point) => point.benchmark)).toEqual([102, 104, 98, 100, 102]);
    expect(joined).toMatchObject({ since: "2026-09-15", benchmarkStatus: "ok", rebasedFrom: null, recordFrom: null });
  });

  it("counts an order placed after the close on the join's day in that day's snapshot, as its holdings do", () => {
    // 22:00 UTC on Friday: after the 21:30 close, before the 22:40 snapshot.
    const second = buy("2026-09-18T22:00:00Z", 105, 1, "NVDA", 50);
    const orders = [firstBuy, second];
    const result = portfolioHistory(
      { ...base, orders, days: [...rebuilt(orders, "2026-09-17"), snapshot("2026-09-18", 210), snapshot("2026-09-21", 216)] },
      "since",
    );
    // Friday: 210 at the close against Thursday's 99 plus the 105 paid.
    const expected = (100 / 100) * (110 / 100) * (99 / 110) * (210 / (99 + 105)) * (216 / 210);
    expect(result.changePct).toBeCloseTo((expected - 1) * 100, 10);
    // The second buy's 105 buys 2.1 units at the price recorded for its minute, from Friday on.
    expect(result.days.map((point) => Number(point.benchmark!.toFixed(9)))).toEqual([102, 104, 98, 205, 209.1]);
  });

  it("names the record's start when no day before a later one is stored, and not once the line reaches the first buy", () => {
    const late = portfolioHistory({ ...base, orders: [firstBuy], days: [snapshot("2026-09-18", 105), snapshot("2026-09-21", 108)] }, "since");
    expect(late).toMatchObject({ since: "2026-09-18", recordFrom: "2026-09-18", rebasedFrom: null });
    // The percentages still count from the first buy: 100 paid, 108 now.
    expect(late.changePct).toBeCloseTo(8, 10);
    expect(portfolioHistory({ ...base, orders: [firstBuy], days: rebuilt([firstBuy], "2026-09-21") }, "since").recordFrom).toBeNull();
    // A fixed range never names it.
    expect(portfolioHistory({ ...base, orders: [firstBuy], days: [snapshot("2026-09-18", 105), snapshot("2026-09-21", 108)] }, "1w").recordFrom).toBeNull();
  });

  it("does not name the record's start on a window rebased on a snapshot, which says why it starts late itself", () => {
    const holdings = [{ symbol: "NVDA", quantity: 2, price: 105, source: "mark" as const }];
    const result = portfolioHistory(
      {
        ...base,
        orders: [firstBuy],
        days: [snapshot("2026-09-18", 210), snapshot("2026-09-21", 216)],
        balanceExplained: false,
        base: { day: "2026-09-18", asOf: "2026-09-18T22:40:00.000Z", holdings },
      },
      "since",
    );
    expect(result).toMatchObject({ rebasedFrom: "2026-09-18", recordFrom: null });
  });
});

describe("the percent line", () => {
  const input: HistoryInput = {
    days: days({ "2026-09-15": 100, "2026-09-16": 160, "2026-09-17": 176 }),
    // 50 more dollars went in on Wednesday: money in, not a gain.
    orders: [buy("2026-09-15T15:00:00Z", 100), buy("2026-09-16T15:00:00Z", 50)],
    benchmarkSymbol: "SPY",
    benchmarkMarks: SPY,
  };

  it("chains the return day by day with buys set aside, ending on changePct", () => {
    const result = portfolioHistory(input, "since");
    const returns = result.days.map((point) => point.returnPct!);
    expect(returns[0]).toBeCloseTo(0, 10);
    expect(returns[1]).toBeCloseTo((160 / 150 - 1) * 100, 10);
    expect(returns[2]).toBeCloseTo(((160 / 150) * (176 / 160) - 1) * 100, 10);
    expect(returns[2]).toBeCloseTo(result.changePct!, 10);
  });

  it("indexes the benchmark to its price at the first buy, ending on benchmarkPct", () => {
    const result = portfolioHistory(input, "since");
    // The fund stood at 50 at the order (the close before it), then 51, 52, 49.
    const returns = result.days.map((point) => point.benchmarkReturnPct!);
    expect(returns[0]).toBeCloseTo(2, 10);
    expect(returns[1]).toBeCloseTo(4, 10);
    expect(returns[2]).toBeCloseTo(-2, 10);
    expect(returns[2]).toBeCloseTo(result.benchmarkPct!, 10);
  });

  it("starts a fixed range at 0 for both lines", () => {
    const long: HistoryInput = {
      ...input,
      days: days({
        "2026-09-14": 100,
        "2026-09-15": 102,
        "2026-09-16": 160,
        "2026-09-17": 176,
        "2026-09-18": 170,
        "2026-09-21": 172,
        "2026-09-22": 180,
      }),
      orders: [buy("2026-09-11T15:00:00Z", 100, 1, "NVDA", 50), buy("2026-09-16T15:00:00Z", 50)],
      benchmarkMarks: SPY_BEFORE,
    };
    const result = portfolioHistory(long, "1w");
    expect(result.since).toBe("2026-09-15");
    expect(result.days[0].returnPct).toBe(0);
    expect(result.days[0].benchmarkReturnPct).toBe(0);
    expect(result.days.at(-1)!.returnPct).toBeCloseTo(result.changePct!, 10);
    expect(result.days.at(-1)!.benchmarkReturnPct).toBeCloseTo(result.benchmarkPct!, 10);
  });

  // A listing that is the benchmark itself, bought at the same prices: the
  // shadow is the account, so the two returns must agree exactly.
  const asBenchmark = (orders: OrderFacts[], dates: string[]) => {
    const value = (day: string) => {
      let units = 0;
      for (const order of orders) {
        if (dayOfClose(order.placedAt) > day) continue;
        units += order.direction === "buy" ? order.quantity! : -order.quantity!;
      }
      return units * SPY.values[SPY.dates.indexOf(day)];
    };
    return portfolioHistory(
      {
        days: dates.map((day) => ({ day, value: value(day) })),
        orders,
        benchmarkSymbol: "SPY",
        benchmarkMarks: SPY,
        listingCloses: { NVDA: SPY },
      },
      "since",
    );
  };
  /** The day whose 21:30 close first comes after an order. */
  const dayOfClose = (placedAt: string) => {
    const date = placedAt.slice(0, 10);
    return Date.parse(placedAt) > Date.parse(markAsOf(date)) ? "9999" : date;
  };

  it("weighs a later, larger buy as your side does: same money, same days", () => {
    // $100 on Monday at 50, then $1,000 more on Thursday at 52 (Wednesday's close).
    const result = asBenchmark(
      [buy("2026-09-14T15:00:00Z", 100, 2), buy("2026-09-17T15:00:00Z", 1000, 1000 / 52)],
      ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18"],
    );
    expect(result.benchmarkStatus).toBe("ok");
    expect(result.benchmarkPct).toBeCloseTo(result.changePct!, 10);
    result.days.forEach((point) => expect(point.benchmarkReturnPct).toBeCloseTo(point.returnPct!, 10));
  });

  it("earns the benchmark nothing while the money is out of the market", () => {
    // In at 50 on Monday, all sold on Wednesday at 52, back in on Friday at 49.
    const result = asBenchmark(
      [
        buy("2026-09-14T15:00:00Z", 100, 2),
        sell("2026-09-16T15:00:00Z", 2),
        buy("2026-09-18T15:00:00Z", 104, 104 / 49),
      ],
      ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-21"],
    );
    // 52 on 50 while in, then 51 on 49 once back: the fall to 49 in between is missed.
    const expected = ((52 / 50) * (51 / 49) - 1) * 100;
    expect(result.changePct).toBeCloseTo(expected, 10);
    expect(result.benchmarkPct).toBeCloseTo(expected, 10);
    // The price alone, 50 to 51, would have said +2%.
    expect(result.benchmarkPct).not.toBeCloseTo(2, 1);
  });

  it("has no percent line where the time-weighted return cannot be told, and keeps the dollars", () => {
    const unpriced = { ...input, orders: [buy("2026-09-15T15:00:00Z", null), buy("2026-09-16T15:00:00Z", 50)] };
    const result = portfolioHistory(unpriced, "since");
    expect(result.changePct).toBeNull();
    expect(result.days.every((point) => point.returnPct === null && point.benchmarkReturnPct === null)).toBe(true);
    expect(result.days.map((point) => point.value)).toEqual([100, 160, 176]);
  });
});
