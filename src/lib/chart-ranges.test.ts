import { describe, expect, it } from "vitest";
import type { Marks, OrderFacts } from "@/lib/benchmark";
import { COPY } from "@/lib/copy";
import { addDays, markAsOf } from "@/lib/marks";
import {
  CARD_RANGES,
  cardRanges,
  historyRanges,
  pickCardRange,
  type HistoryInput,
} from "@/lib/portfolio-history";
import { rangeMovers, rangeTrades, withStory, type StoryHolding } from "@/lib/portfolio-story";

/**
 * The account card's ranges (1W, 14D, 30D, 90D, First buy) and what the
 * strip shows past a week: each holding's dollars from its price moves
 * while held, buys and sells set aside.
 *
 * Twenty market days, Mon Sep 14 to Fri Oct 9 2026, no holidays.
 * - NVIDIA, 1 unit bought on the first day and held throughout: 100 + i.
 * - Tesla, 1 unit bought on the first day, sold whole on Mon Oct 5 at that
 *   close (190); it rallies to 250 after, which is no longer the account's.
 * - Apple, 1 unit bought mid-range on Thu Oct 1 for $50, its close that day.
 */
const DAYS: string[] = [];
for (let day = new Date("2026-09-14T12:00:00Z"); DAYS.length < 20; day = new Date(day.getTime() + 86_400_000)) {
  const weekday = day.getUTCDay();
  if (weekday !== 0 && weekday !== 6) DAYS.push(day.toISOString().slice(0, 10));
}
const LAST = DAYS.at(-1)!;

const PRICE: Record<string, (day: string, index: number) => number> = {
  NVDA: (_day, index) => 100 + index,
  // 200 on Sep 25 (index 9), down a dollar a day to 190 on Oct 5 (index 15), then up.
  TSLA: (_day, index) => (index <= 9 ? 200 : index <= 15 ? 200 - ((index - 9) * 10) / 6 : 190 + (index - 15) * 15),
  // 48 before Oct 1 (index 13), 50 on it, 55 by Oct 9 (index 19).
  AAPL: (_day, index) => (index < 13 ? 48 : 50 + ((index - 13) * 5) / 6),
};
const closes: Record<string, Marks> = Object.fromEntries(
  Object.entries(PRICE).map(([symbol, price]) => [symbol, { dates: DAYS, values: DAYS.map((day, index) => price(day, index)) }]),
);
const close = (symbol: string, day: string) => closes[symbol].values[DAYS.indexOf(day)];

const order = (symbol: string, direction: "buy" | "sell", day: string, quantity: number): OrderFacts => ({
  symbol,
  direction,
  quantity,
  usd: direction === "buy" ? quantity * close(symbol, day) : null,
  placedAt: `${day}T15:00:00.000Z`,
});
const ORDERS: OrderFacts[] = [
  order("NVDA", "buy", "2026-09-14", 1),
  order("TSLA", "buy", "2026-09-14", 1),
  order("AAPL", "buy", "2026-10-01", 1),
  order("TSLA", "sell", "2026-10-05", 1),
];

function stored(days: readonly string[] = DAYS) {
  return days.map((day) => {
    const held = new Map<string, number>();
    for (const entry of ORDERS) {
      if (entry.placedAt.slice(0, 10) > day) continue;
      held.set(entry.symbol, (held.get(entry.symbol) ?? 0) + (entry.direction === "buy" ? 1 : -1) * entry.quantity!);
    }
    const holdings: StoryHolding[] = [...held]
      .filter(([, quantity]) => quantity > 0)
      .map(([symbol, quantity]) => ({ symbol, quantity, price: close(symbol, day) }));
    return {
      day,
      asOf: markAsOf(day),
      holdings,
      value: holdings.reduce((sum, holding) => sum + holding.quantity * holding.price, 0),
    };
  });
}

function story(days = stored()) {
  const input: HistoryInput = { days, orders: ORDERS, benchmarkMarks: closes.NVDA, listingCloses: closes };
  const { ranges, available } = historyRanges(input);
  return { ranges: withStory(ranges, { days, orders: ORDERS, listingCloses: closes }, { rebased: false }), available };
}

describe("a range's movers: price moves while held, buys and sells set aside", () => {
  const { ranges } = story();
  const range = ranges["14d"]!;
  const by = (symbol: string) => range.contributions!.find((entry) => entry.symbol === symbol)!;

  it("starts 14D at the first close on or after today minus 14 days", () => {
    expect(range.since).toBe("2026-09-25");
  });

  it("counts a holding held throughout as its units times its price move", () => {
    expect(by("NVDA").usd).toBeCloseTo(close("NVDA", LAST) - close("NVDA", "2026-09-25"), 9);
  });

  it("counts a stock bought mid-range only from what was paid, never the buy itself", () => {
    // Paid $50 on Oct 1 at that close; worth 55 now.
    expect(by("AAPL").usd).toBeCloseTo(close("AAPL", LAST) - 50, 9);
  });

  it("counts a stock sold mid-range only up to the sale, never its proceeds or its move after", () => {
    expect(by("TSLA").usd).toBeCloseTo(190 - 200, 9);
  });

  it("adds up to the range's dollar change, which sets money in and out aside", () => {
    const sum = range.contributions!.reduce((total, entry) => total + entry.usd, 0);
    expect(range.changeUsd).toBeCloseTo(sum, 9);
    const first = range.days[0];
    const last = range.days.at(-1)!;
    // Worth now, less worth at the start, less the $50 put in, plus Tesla's $190 taken out.
    expect(sum).toBeCloseTo(last.value - first.value - 50 + 190, 9);
  });

  it("sorts by the size of the dollars and gives each holding's own return while held, over the same days", () => {
    expect(range.contributions!.map((entry) => entry.symbol)).toEqual(["NVDA", "TSLA", "AAPL"]);
    expect(by("NVDA").pct).toBeCloseTo((close("NVDA", LAST) / close("NVDA", "2026-09-25") - 1) * 100, 9);
    // Tesla up to its sale at 190, never its rally after: the same sign and days as its dollars.
    expect(by("TSLA").pct).toBeCloseTo((190 / 200 - 1) * 100, 9);
    // Apple from the $50 paid, not from before it was bought.
    expect(by("AAPL").pct).toBeCloseTo((close("AAPL", LAST) / 50 - 1) * 100, 9);
  });

  it("keeps the percent's sign the dollars' when a holding is added to mid-range", () => {
    // NVIDIA 100, 110, 105: one unit, nine more bought at 110. A time-weighted
    // return would read +5% beside a $40 loss; the money put in reads -3.7%.
    const prices: Record<string, number> = { [DAYS[0]]: 100, [DAYS[1]]: 110, [DAYS[2]]: 105 };
    const nvda: Marks = { dates: DAYS.slice(0, 3), values: DAYS.slice(0, 3).map((day) => prices[day]) };
    const orders: OrderFacts[] = [
      { symbol: "NVDA", direction: "buy", quantity: 1, usd: 100, placedAt: `${DAYS[0]}T15:00:00.000Z` },
      { symbol: "NVDA", direction: "buy", quantity: 9, usd: 990, placedAt: `${DAYS[1]}T15:00:00.000Z` },
    ];
    const held = [1, 10, 10];
    const days = DAYS.slice(0, 3).map((day, index) => ({
      day,
      asOf: markAsOf(day),
      holdings: [{ symbol: "NVDA", quantity: held[index], price: prices[day] }],
      value: held[index] * prices[day],
    }));
    const { ranges } = historyRanges({ days, orders, benchmarkMarks: nvda, listingCloses: { NVDA: nvda } });
    const row = withStory(ranges, { days, orders, listingCloses: { NVDA: nvda } }, { rebased: false }).since!.contributions![0];
    expect(row.usd).toBeCloseTo(-40, 9);
    expect(row.pct).toBeCloseTo((-40 / 1090) * 100, 9);
  });

  it("counts the fee on a buy in both figures", () => {
    // Paid $51 for what was worth $50 at that close: a fee of $1.
    const orders = [{ ...ORDERS[0], usd: 101 }];
    const days = stored(DAYS.slice(0, 3)).map((entry) => ({
      ...entry,
      holdings: entry.holdings.filter((holding) => holding.symbol === "NVDA"),
      value: close("NVDA", entry.day),
    }));
    const { ranges } = historyRanges({ days, orders, benchmarkMarks: closes.NVDA, listingCloses: closes });
    const since = withStory(ranges, { days, orders, listingCloses: closes }, { rebased: false }).since!;
    const nvda = since.contributions![0];
    expect(nvda.usd).toBeCloseTo(close("NVDA", DAYS[2]) - 101, 9);
    expect(nvda.pct).toBeCloseTo((close("NVDA", DAYS[2]) / 101 - 1) * 100, 9);
  });

  it("since first buy counts every day from the first buy", () => {
    const since = ranges.since!;
    const nvda = since.contributions!.find((entry) => entry.symbol === "NVDA")!;
    expect(nvda.usd).toBeCloseTo(close("NVDA", LAST) - 100, 9);
    const tsla = since.contributions!.find((entry) => entry.symbol === "TSLA")!;
    expect(tsla.usd).toBeCloseTo(190 - close("TSLA", "2026-09-14"), 9);
  });

  it("lists the trades in the range, names once each", () => {
    expect(rangeTrades(range.orders)).toEqual({ bought: ["AAPL"], moreBought: 0, sold: ["TSLA"], moreSold: 0 });
    expect(rangeTrades(ranges.since!.orders)).toEqual({ bought: ["NVDA", "TSLA", "AAPL"], moreBought: 0, sold: ["TSLA"], moreSold: 0 });
    expect(rangeTrades([])).toBeNull();
  });

  it("does not name a trade that landed on a fixed range's first day, which is its base", () => {
    // Apple bought on Oct 1, so a range based at Oct 1's close starts with it already held.
    expect(rangeTrades(ranges.since!.orders, "2026-10-01")).toEqual({ bought: [], moreBought: 0, sold: ["TSLA"], moreSold: 0 });
    expect(rangeTrades(ranges.since!.orders, "2026-10-05")).toBeNull();
    expect(rangeTrades(range.orders, range.since)).toEqual({ bought: ["AAPL"], moreBought: 0, sold: ["TSLA"], moreSold: 0 });
  });
});

describe("the movers list and its trade line", () => {
  it("keeps at most five rows, largest dollars first, and drops a move under a cent", () => {
    const rows = rangeMovers(
      [
      { symbol: "A", usd: 0.2 },
      { symbol: "B", usd: -3 },
      { symbol: "C", usd: 1 },
      { symbol: "D", usd: 0.004 },
      { symbol: "E", usd: -0.5 },
      { symbol: "F", usd: 2 },
      { symbol: "G", usd: 0.1 },
      ],
      5.6,
    );
    expect(rows.map((row) => row.symbol)).toEqual(["B", "F", "C", "E", "A"]);
    expect(rangeMovers([{ symbol: "A", usd: 0 }], 0)).toEqual([]);
    expect(rangeMovers(undefined, 0)).toEqual([]);
  });

  it("draws nothing when a day of the range is unknown, as the total does", () => {
    expect(rangeMovers([{ symbol: "A", usd: 2 }], null)).toEqual([]);
    expect(rangeMovers([{ symbol: "A", usd: 2 }], undefined)).toEqual([]);
    // A sell with no quantity makes its day unknown: the range's total and its rows go together.
    const orders = [...ORDERS.slice(0, 3), { ...ORDERS[3], quantity: null }];
    const days = stored();
    const { ranges } = historyRanges({ days, orders, benchmarkMarks: closes.NVDA, listingCloses: closes });
    const range = withStory(ranges, { days, orders, listingCloses: closes }, { rebased: false })["14d"]!;
    expect(range.changeUsd).toBeNull();
    expect(range.contributions!.length).toBeGreaterThan(0);
    expect(rangeMovers(range.contributions, range.changeUsd)).toEqual([]);
  });

  it("names up to three per side, then how many more", () => {
    const trades = rangeTrades([
      ...["A", "B", "C", "D", "E"].map((symbol) => ({ symbol, direction: "buy" as const, day: "2026-10-01" })),
      { symbol: "A", direction: "buy" as const, day: "2026-10-01" },
      { symbol: "S", direction: "sell" as const, day: "2026-10-01" },
    ])!;
    expect(trades).toEqual({ bought: ["A", "B", "C"], moreBought: 2, sold: ["S"], moreSold: 0 });
  });

  it("reads plainly, names not tickers, no dashes", () => {
    const line = COPY.portfolioRangeTrades;
    expect(line({ bought: ["Alphabet"], moreBought: 0, sold: ["SpaceX"], moreSold: 0 })).toBe(
      "Bought Alphabet. Sold SpaceX.",
    );
    expect(line({ bought: ["Alphabet", "Apple", "Tesla"], moreBought: 2, sold: [], moreSold: 0 })).toBe(
      "Bought Alphabet, Apple, Tesla and 2 more.",
    );
    expect(line({ bought: [], moreBought: 0, sold: ["Apple", "Tesla"], moreSold: 0 })).toBe(
      "Sold Apple and Tesla.",
    );
    const both = line({ bought: ["NVIDIA", "Tesla", "Apple"], moreBought: 0, sold: ["Tesla", "Apple"], moreSold: 0 });
    expect(both).toBe("Bought NVIDIA, Tesla and Apple. Sold Tesla and Apple.");
    for (const sentence of both.split(". ")) expect(sentence.match(/ and /g)?.length ?? 0).toBeLessThanOrEqual(1);
    expect(COPY.portfolioMoversLabel("Sep 25")).toBe("What moved your portfolio since Sep 25");
    expect(COPY.portfolioMoversNote("0.4%")).toBe("Each holding's result while you held it. Includes the 0.4% fee on buys.");
    expect(COPY.portfolioMoverAria({ name: "Tesla", usd: "−$0.66", pct: "−5.0%" })).toBe("Tesla, −$0.66 while held, −5.0%");
    for (const text of [COPY.portfolioMoversLabel("Sep 25"), COPY.portfolioMoversNote("0.4%"), line({ bought: ["A"], moreBought: 1, sold: ["B"], moreSold: 3 })]) {
      expect(text).not.toMatch(/ [-–—] |[–—]/);
    }
  });
});

describe("which ranges the card offers", () => {
  it("offers 14D once the first day is 14 calendar days back, not 30D or 90D yet", () => {
    // Sep 14 to Oct 9: 25 days.
    const { ranges, available } = story();
    expect(cardRanges(available, ranges)).toEqual(["1w", "14d", "since"]);
    expect(ranges["14d"]!.days.at(-1)!.day).toBe(LAST);
    expect(CARD_RANGES.map((range) => COPY.portfolioRanges[range])).toEqual(["1W", "14D", "30D", "90D", "First buy"]);
  });

  it("offers 1W and First buy from the second day, before a week fills", () => {
    const days = stored(DAYS.slice(0, 3));
    const { ranges, available } = historyRanges({ days, orders: ORDERS.slice(0, 2), benchmarkMarks: closes.NVDA, listingCloses: closes });
    expect(available).toEqual(["since"]);
    expect(cardRanges(available, ranges)).toEqual(["1w", "since"]);
    expect(ranges["1w"]!.days.map((point) => point.day)).toEqual(DAYS.slice(0, 3));
  });

  it("offers 30D at 30 days and 90D at 90 days, counted in calendar days to today", () => {
    const at = (first: string) => {
      const days = [];
      for (let day = first; day <= "2026-10-09"; day = addDays(day, 1)) days.push({ day, value: 100 });
      return cardRanges(historyRanges({ days, orders: [], benchmarkMarks: closes.NVDA }).available, {});
    };
    expect(at("2026-09-26")).toEqual(["1w", "since"]);
    expect(at("2026-09-25")).toEqual(["1w", "14d", "since"]);
    expect(at("2026-09-10")).toEqual(["1w", "14d", "since"]);
    expect(at("2026-09-09")).toEqual(["1w", "14d", "30d", "since"]);
    expect(at("2026-07-12")).toEqual(["1w", "14d", "30d", "since"]);
    expect(at("2026-07-11")).toEqual(["1w", "14d", "30d", "90d", "since"]);
  });
});

describe("the range the card opens on", () => {
  const offered = ["1w", "14d", "since"] as const;

  it("is First buy by default", () => {
    expect(pickCardRange(null, offered)).toBe("since");
  });

  it("is the one the viewer picked while it is offered", () => {
    expect(pickCardRange("1w", offered)).toBe("1w");
    expect(pickCardRange("14d", offered)).toBe("14d");
  });

  it("falls back to First buy when the remembered range is not offered", () => {
    expect(pickCardRange("90d", offered)).toBe("since");
    // A range the card no longer shows, kept from before.
    expect(pickCardRange("1m", offered)).toBe("since");
    expect(pickCardRange("nonsense", offered)).toBe("since");
  });
});
