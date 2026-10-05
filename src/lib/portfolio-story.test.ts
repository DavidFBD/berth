import { describe, expect, it } from "vitest";
import type { Marks, OrderFacts } from "@/lib/benchmark";
import { markAsOf } from "@/lib/marks";
import { combineAccountDays } from "@/lib/server/portfolio";
import { historyRanges } from "@/lib/portfolio-history";
import {
  dailyStory,
  pickMove,
  rangeStory,
  withStory,
  type StoryDay,
  type StoryHolding,
} from "@/lib/portfolio-story";

/**
 * The spec for a day's story. Days are September 2026, Mon 14 to Fri 18.
 * A stored day is valued at its close (21:30 UTC); an order lands on the
 * first day whose close comes after it.
 */

type Day = StoryDay & { value: number };

const day = (date: string, holdings: StoryHolding[]): Day => ({
  day: date,
  asOf: markAsOf(date),
  holdings,
  value: holdings.reduce((sum, holding) => sum + holding.quantity * holding.price, 0),
});

const buy = (placedAt: string, usd: number | null, quantity: number | null, symbol = "NVDA"): OrderFacts => ({
  symbol,
  direction: "buy",
  quantity,
  usd,
  placedAt,
});

const sell = (placedAt: string, quantity: number, symbol = "NVDA"): OrderFacts => ({
  symbol,
  direction: "sell",
  quantity,
  usd: null,
  placedAt,
});

const marks = (byDay: Record<string, number>): Marks => {
  const dates = Object.keys(byDay).sort();
  return { dates, values: dates.map((date) => byDay[date]) };
};

describe("dailyStory", () => {
  it("counts a price move on what was held, and never a buy as a gain", () => {
    const { stories } = dailyStory({
      days: [
        day("2026-09-14", [{ symbol: "NVDA", quantity: 1, price: 100 }]),
        // A second buy of $50 landed today; NVIDIA rose from 100 to 110.
        day("2026-09-15", [{ symbol: "NVDA", quantity: 1.5, price: 110 }]),
      ],
      orders: [buy("2026-09-14T15:00:00Z", 100, 1), buy("2026-09-15T15:00:00Z", 50, 0.5)],
    });
    // Held through: 1 × (110 − 100) = 10. Bought today: 0.5 × 110 − 50 = 5.
    expect(stories[1].change).toBeCloseTo(15);
    // Over the money at work: yesterday's 100 plus today's 50.
    expect(stories[1].changePct).toBeCloseTo(10);
    expect(stories[1].top).toEqual({ symbol: "NVDA", usd: expect.closeTo(15), pct: expect.closeTo(10) });
    expect(stories[1].fromBuy).toBe(false);
    // The value rose by 65; 50 of it was money in.
    expect(stories[1].change).toBeCloseTo(165 - 100 - 50);
  });

  it("tells the first day from what was paid, fee included", () => {
    const { stories } = dailyStory({
      days: [day("2026-09-14", [{ symbol: "NVDA", quantity: 0.997, price: 101 }])],
      orders: [buy("2026-09-14T15:00:00Z", 100, 0.997)],
    });
    expect(stories[0].fromBuy).toBe(true);
    expect(stories[0].change).toBeCloseTo(0.997 * 101 - 100);
    expect(stories[0].top?.pct).toBeCloseTo(((0.997 * 101) / 100 - 1) * 100);
  });

  it("does not count a sell, and values what was sold at the day's price", () => {
    const { stories, orders } = dailyStory({
      days: [
        day("2026-09-14", [
          { symbol: "NVDA", quantity: 2, price: 100 },
          { symbol: "AAPL", quantity: 1, price: 50 },
        ]),
        // Sold one NVIDIA during the day; NVIDIA closed at 90, Apple at 52.
        day("2026-09-15", [
          { symbol: "NVDA", quantity: 1, price: 90 },
          { symbol: "AAPL", quantity: 1, price: 52 },
        ]),
      ],
      orders: [buy("2026-09-14T15:00:00Z", 200, 2), buy("2026-09-14T15:00:00Z", 50, 1, "AAPL"), sell("2026-09-15T15:00:00Z", 1)],
    });
    // Both NVIDIA lost 10 each, the sold one included, and Apple made 2.
    expect(stories[1].change).toBeCloseTo(-18);
    expect(stories[1].top).toEqual({ symbol: "NVDA", usd: expect.closeTo(-20), pct: expect.closeTo(-10) });
    expect(orders.map((order) => [order.day, order.direction, order.usd])).toEqual([
      ["2026-09-14", "buy", 200],
      ["2026-09-14", "buy", 50],
      ["2026-09-15", "sell", 90],
    ]);
  });

  it("takes the close for a listing sold out of the holdings that day", () => {
    const { stories } = dailyStory({
      days: [day("2026-09-14", [{ symbol: "NVDA", quantity: 1, price: 100 }]), day("2026-09-15", [])],
      orders: [buy("2026-09-14T15:00:00Z", 100, 1), sell("2026-09-15T15:00:00Z", 1)],
      listingCloses: { NVDA: marks({ "2026-09-14": 100, "2026-09-15": 104 }) },
    });
    expect(stories[1].change).toBeCloseTo(4);
  });

  it("says nothing when a price is missing on a day", () => {
    const { stories } = dailyStory({
      days: [day("2026-09-14", [{ symbol: "NVDA", quantity: 1, price: 100 }]), day("2026-09-15", [])],
      orders: [buy("2026-09-14T15:00:00Z", 100, 1), sell("2026-09-15T15:00:00Z", 1)],
      // No close for the 15th: the sold listing cannot be valued.
      listingCloses: { NVDA: marks({ "2026-09-14": 100 }) },
    });
    expect(stories[1]).toMatchObject({ change: null, changePct: null, top: null });
  });

  it("says nothing for a day with a buy of no dollar cost", () => {
    const { stories } = dailyStory({
      days: [day("2026-09-14", [{ symbol: "NVDA", quantity: 1, price: 100 }])],
      orders: [buy("2026-09-14T15:00:00Z", null, 1)],
    });
    expect(stories[0].change).toBeNull();
  });

  it("never reads money that moved without an order as a gain", () => {
    const { stories } = dailyStory({
      days: [
        day("2026-09-14", [{ symbol: "NVDA", quantity: 1, price: 100 }]),
        // One more NVIDIA arrived by transfer; the price did not move.
        day("2026-09-15", [{ symbol: "NVDA", quantity: 2, price: 100 }]),
      ],
      orders: [buy("2026-09-14T15:00:00Z", 100, 1)],
    });
    expect(stories[1].change).toBeCloseTo(0);
  });

  it("adds up a merged account's two parts of one listing", () => {
    const row = (entry: Day, createdAt: string) => ({
      ...entry,
      holdings: entry.holdings.map((holding) => ({ ...holding, source: "mark" as const })),
      source: "snapshot" as const,
      createdAt,
    });
    const own = {
      id: "a",
      rows: [
        row(day("2026-09-14", [{ symbol: "NVDA", quantity: 1, price: 100 }]), "2026-09-14T22:00:00Z"),
        row(day("2026-09-15", [{ symbol: "NVDA", quantity: 1, price: 110 }]), "2026-09-15T22:00:00Z"),
      ],
    };
    const retired = {
      id: "b",
      parent: "a",
      retiredAt: "2026-09-20T00:00:00Z",
      rows: [
        row(day("2026-09-14", [{ symbol: "NVDA", quantity: 2, price: 100 }]), "2026-09-14T22:00:00Z"),
        row(day("2026-09-15", [{ symbol: "NVDA", quantity: 2, price: 110 }]), "2026-09-15T22:00:00Z"),
      ],
    };
    const days = combineAccountDays(own, [retired]);
    const { stories } = dailyStory({ days, orders: [] });
    // Three NVIDIA held across both accounts, each up 10.
    expect(stories[1].change).toBeCloseTo(30);
    expect(stories[1].top?.symbol).toBe("NVDA");
  });

  it("ends on the live point at live prices, replacing today's stored close", () => {
    const { stories } = dailyStory({
      days: [
        day("2026-09-14", [{ symbol: "NVDA", quantity: 1, price: 100 }]),
        day("2026-09-15", [{ symbol: "NVDA", quantity: 1, price: 101 }]),
      ],
      orders: [buy("2026-09-14T15:00:00Z", 100, 1)],
      live: { day: "2026-09-15", asOf: "2026-09-15T23:00:00Z", value: 105, benchmarkPrice: null, prices: { NVDA: 105 } },
      liveHoldings: [{ symbol: "NVDA", quantity: 1, price: 105 }],
    });
    expect(stories).toHaveLength(2);
    expect(stories[1].change).toBeCloseTo(5);
  });

  it("names the holding that moved the most dollars, not the most percent", () => {
    const { stories } = dailyStory({
      days: [
        day("2026-09-14", [
          { symbol: "NVDA", quantity: 1, price: 100 },
          { symbol: "TSLA", quantity: 0.1, price: 100 },
        ]),
        day("2026-09-15", [
          { symbol: "NVDA", quantity: 1, price: 102 },
          { symbol: "TSLA", quantity: 0.1, price: 110 },
        ]),
      ],
      orders: [],
    });
    expect(stories[1].top).toEqual({ symbol: "NVDA", usd: expect.closeTo(2), pct: expect.closeTo(2) });
  });
});

describe("rangeStory and withStory", () => {
  const days = [
    day("2026-09-14", [{ symbol: "NVDA", quantity: 1, price: 100 }]),
    day("2026-09-15", [
      { symbol: "NVDA", quantity: 1, price: 104 },
      { symbol: "AAPL", quantity: 1, price: 50 },
    ]),
    day("2026-09-16", [
      { symbol: "NVDA", quantity: 1, price: 102 },
      { symbol: "AAPL", quantity: 1, price: 53 },
    ]),
  ];
  const orders = [buy("2026-09-14T15:00:00Z", 100, 1), buy("2026-09-15T15:00:00Z", 51, 1, "AAPL")];

  it("adds up each holding over since first buy, its first day from what was paid", () => {
    const { ranges } = historyRanges({ days, orders, benchmarkMarks: { dates: [], values: [] } });
    const story = withStory(ranges, { days, orders }, { rebased: false });
    const since = story.since!;
    // NVIDIA: 0 on the buy day, +4, −2. Apple: 50 − 51 on its buy day, +3.
    expect(since.contributions).toEqual([
      { symbol: "AAPL", usd: expect.closeTo(2) },
      { symbol: "NVDA", usd: expect.closeTo(2) },
    ]);
    expect(since.changeUsd).toBeCloseTo(4);
    expect(since.orders?.map((order) => order.symbol)).toEqual(["NVDA", "AAPL"]);
    expect(since.days[0].fromBuy).toBe(true);
    expect(since.days[2].top?.symbol).toBe("AAPL");
  });

  it("starts a fixed window from its first close, so that day's change is not counted", () => {
    const { stories, orders: landed } = dailyStory({ days, orders });
    const byDay = new Map(stories.map((story) => [story.day, story]));
    const result = {
      range: "1w" as const,
      days: days.slice(1).map((entry) => ({ day: entry.day, value: entry.value, benchmark: null })),
      since: "2026-09-15",
      changePct: null,
      benchmarkPct: null,
      tradingDays: 1,
      benchmarkStatus: "ok" as const,
      rebasedFrom: null,
      recordFrom: null,
    };
    const story = rangeStory(result, byDay, landed, false);
    expect(story.changeUsd).toBeCloseTo(1);
    // The Apple buy landed on the window's first point: it is marked.
    expect(story.orders.map((order) => order.symbol)).toEqual(["AAPL"]);
  });

  it("tells a window with an unknown day as no total", () => {
    const gap = [days[0], day("2026-09-15", [])];
    const { stories, orders: landed } = dailyStory({ days: gap, orders: [orders[0], sell("2026-09-15T15:00:00Z", 1)] });
    const byDay = new Map(stories.map((story) => [story.day, story]));
    const result = {
      range: "since" as const,
      days: gap.map((entry) => ({ day: entry.day, value: entry.value, benchmark: null })),
      since: "2026-09-14",
      changePct: null,
      benchmarkPct: null,
      tradingDays: 1,
      benchmarkStatus: "ok" as const,
      rebasedFrom: null,
      recordFrom: null,
    };
    expect(rangeStory(result, byDay, landed, true).changeUsd).toBeNull();
  });
});

describe("pickMove", () => {
  const post = { url: "https://x.com/a/status/1", name: "A", username: "a" };
  const points = [
    { day: "2026-09-15", value: 1, benchmark: null },
    { day: "2026-09-16", value: 1, benchmark: null },
  ];

  it("keeps a move on a day on the line in a listing held then, the largest", () => {
    const held = (date: string, symbol: string) => symbol !== "AAPL";
    const move = pickMove(
      [
        { symbol: "NVDA", changePct: 4, asOf: "2026-09-16", post },
        { symbol: "TSLA", changePct: -6, asOf: "2026-09-16", post },
        { symbol: "AAPL", changePct: 9, asOf: "2026-09-16", post },
        { symbol: "NVDA", changePct: 12, asOf: "2026-09-12", post },
      ],
      points,
      held,
    );
    expect(move).toMatchObject({ day: "2026-09-16", symbol: "TSLA", changePct: -6 });
  });

  it("is null when nothing held moved", () => {
    expect(pickMove([], points, () => true)).toBeNull();
  });
});
