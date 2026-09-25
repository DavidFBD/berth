import { describe, expect, it } from "vitest";
import type { OrderFacts } from "@/lib/benchmark";
import {
  dayOfOrder,
  ledgerDays,
  ledgerExplains,
  ledgerQuantities,
  repriceHolding,
  snapshotDay,
  valueHoldings,
} from "@/lib/portfolio-days";

const order = (
  direction: "buy" | "sell",
  symbol: string,
  quantity: number | null,
  placedAt: string,
  usd: number | null = 10,
): OrderFacts => ({ direction, symbol, quantity, placedAt, usd });

describe("valueHoldings", () => {
  it("prices every held listing and says where each price came from", () => {
    const result = valueHoldings({ NVDA: 2, SGOV: 0 }, (symbol) =>
      symbol === "NVDA" ? { price: 180, source: "oracle" } : undefined,
    );
    expect(result).toEqual({
      ok: true,
      day: { value: 360, holdings: [{ symbol: "NVDA", quantity: 2, price: 180, source: "oracle" }] },
    });
  });

  it("refuses a value missing one of its parts", () => {
    expect(valueHoldings({ NVDA: 2, TSLA: 1 }, (s) => (s === "NVDA" ? { price: 1, source: "mark" } : undefined))).toEqual({
      ok: false,
      unpriced: ["TSLA"],
    });
  });
});

describe("the ledger", () => {
  const orders = [
    order("buy", "NVDA", 2, "2026-09-21T09:30:00Z"),
    order("buy", "NVDA", 1, "2026-09-22T22:00:00Z"),
    order("sell", "NVDA", 1.5, "2026-09-24T15:00:00Z", null),
  ];

  it("counts buys less sells placed by a moment", () => {
    expect(ledgerQuantities(orders, Date.parse("2026-09-22T21:30:00Z"))).toEqual({ NVDA: 2 });
    expect(ledgerQuantities(orders, Infinity)).toEqual({ NVDA: 1.5 });
    expect(ledgerQuantities([order("buy", "NVDA", null, "2026-09-21T09:30:00Z")], Infinity)).toBeUndefined();
  });

  it("explains a balance only when every listing matches within the tolerance", () => {
    expect(ledgerExplains(orders, { NVDA: 1.5 })).toBe(true);
    expect(ledgerExplains(orders, { NVDA: 1.504 })).toBe(true);
    expect(ledgerExplains(orders, { NVDA: 1.6 })).toBe(false);
    expect(ledgerExplains(orders, { NVDA: 1.5, SGOV: 3 })).toBe(false);
    expect(ledgerExplains(orders, {})).toBe(false);
    expect(ledgerExplains([], {})).toBe(true);
  });

  it("puts an order in the first market day whose close comes after it", () => {
    expect(dayOfOrder("2026-09-21T09:30:00Z")).toBe("2026-09-21");
    expect(dayOfOrder("2026-09-22T22:00:00Z")).toBe("2026-09-23");
    expect(dayOfOrder("2026-09-25T22:00:00Z")).toBe("2026-09-28");
  });

  it("rebuilds past closes from the orders, and leaves out a day it has no close for", () => {
    const closes = {
      NVDA: {
        dates: ["2026-09-21", "2026-09-22", "2026-09-24"],
        values: [100, 110, 120],
      },
    };
    const rows = ledgerDays({ orders, closes, through: "2026-09-24" });
    expect(rows.map((row) => [row.day, row.value])).toEqual([
      ["2026-09-21", 200],
      ["2026-09-22", 220],
      // The 23rd has no close; the 24th holds 1.5 after the sell.
      ["2026-09-24", 180],
    ]);
    expect(rows[0].asOf).toBe("2026-09-21T21:30:00.000Z");
    expect(rows[0].holdings).toEqual([{ symbol: "NVDA", quantity: 2, price: 100, source: "mark" }]);
  });
});

describe("snapshotDay", () => {
  it("belongs to the day whose close just passed, even after midnight UTC", () => {
    expect(snapshotDay(new Date("2026-09-25T23:10:00Z"))).toBe("2026-09-25");
    expect(snapshotDay(new Date("2026-09-26T00:40:00Z"))).toBe("2026-09-25");
  });

  it("is no day before the close, long after it, or on a day the market was shut", () => {
    expect(snapshotDay(new Date("2026-09-25T15:00:00Z"))).toBeUndefined();
    expect(snapshotDay(new Date("2026-09-26T05:00:00Z"))).toBeUndefined();
    expect(snapshotDay(new Date("2026-09-26T23:10:00Z"))).toBeUndefined();
  });
});

describe("repriceHolding", () => {
  const holdings = [
    { symbol: "NVDA", quantity: 2, price: 500, source: "mark" as const },
    { symbol: "SGOV", quantity: 1, price: 100, source: "oracle" as const },
  ];

  it("puts a changed close right and recomputes the value", () => {
    expect(repriceHolding(holdings, "NVDA", 101, "mark")).toEqual({
      value: 302,
      holdings: [{ ...holdings[0], price: 101 }, holdings[1]],
    });
  });

  it("leaves an oracle price and an unchanged close alone", () => {
    expect(repriceHolding(holdings, "SGOV", 90, "mark")).toBeUndefined();
    expect(repriceHolding(holdings, "NVDA", 500, "mark")).toBeUndefined();
    expect(repriceHolding(holdings, "AAPL", 1, "mark")).toBeUndefined();
  });
});
