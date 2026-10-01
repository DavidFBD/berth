import { describe, expect, it } from "vitest";
import { FIRST_STOCK_DAYS, firstStockShows } from "@/lib/first-stock";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 1, 12);

describe("firstStockShows", () => {
  it("shows for two weeks from the first buy", () => {
    expect(firstStockShows({ closed: false, firstBuyAt: NOW - DAY, createdAt: NOW - 30 * DAY }, NOW)).toBe(true);
    expect(firstStockShows({ closed: false, firstBuyAt: NOW - FIRST_STOCK_DAYS * DAY + 1, createdAt: 0 }, NOW)).toBe(true);
    expect(firstStockShows({ closed: false, firstBuyAt: NOW - FIRST_STOCK_DAYS * DAY, createdAt: 0 }, NOW)).toBe(false);
  });

  it("never after Got it", () => {
    expect(firstStockShows({ closed: true, firstBuyAt: NOW - DAY, createdAt: NOW - DAY }, NOW)).toBe(false);
  });

  it("counts from the account's birth when no buy reached the ledger", () => {
    expect(firstStockShows({ closed: false, firstBuyAt: null, createdAt: NOW - 3 * DAY }, NOW)).toBe(true);
    expect(firstStockShows({ closed: false, firstBuyAt: null, createdAt: NOW - 20 * DAY }, NOW)).toBe(false);
  });
});
