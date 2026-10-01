import { describe, expect, it } from "vitest";
import { BENCHMARKS, DEFAULT_BENCHMARK, findBenchmark } from "@/lib/benchmarks";
import { TOKEN_LISTINGS } from "@/lib/listings";
import { MARKET_ID_BY_SYMBOL } from "@/lib/market-ids";

describe("benchmarks", () => {
  it("offers five, by name, the S&P 500 ETF first", () => {
    expect(BENCHMARKS.map((b) => b.symbol)).toEqual(["SPY", "QQQ", "PAXG", "BTC", "SGOV"]);
    expect(BENCHMARKS.map((b) => b.name)).toEqual([
      "S&P 500 ETF",
      "Nasdaq 100 ETF",
      "Gold",
      "Bitcoin",
      "Treasury bills",
    ]);
    expect(DEFAULT_BENCHMARK).toBe("SPY");
    for (const benchmark of BENCHMARKS) expect(benchmark.marketId).toBeTruthy();
  });

  it("keeps Gold and Bitcoin off the board and out of the listings", () => {
    for (const symbol of ["PAXG", "BTC"]) {
      expect(TOKEN_LISTINGS.some((listing) => listing.symbol === symbol)).toBe(false);
      expect(MARKET_ID_BY_SYMBOL[symbol]).toBeUndefined();
      expect(findBenchmark(symbol)?.listingAddress).toBeNull();
    }
    expect(findBenchmark("spy")?.listingAddress).toMatch(/^0x[0-9a-f]{40}$/);
  });

  it("knows nothing else", () => {
    expect(findBenchmark("NVDA")).toBeUndefined();
    expect(findBenchmark(null)).toBeUndefined();
  });
});
