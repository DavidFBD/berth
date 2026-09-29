import { afterEach, describe, expect, it, vi } from "vitest";
import { MARKET_ID_BY_SYMBOL } from "@/lib/market-ids";
import { loadPerformance } from "@/lib/server/listing-performance";
import { fetchMarkPoints } from "@/lib/server/marks";
import type { MultiplierReader } from "@/lib/server/token-multipliers";
import type { MultiplierHistory } from "@/lib/token-multiplier";

/**
 * DefiLlama's SGOV around 2 September 2026, as it serves them: the token's
 * own price through the 1st, the share's (a dividend lower, and a
 * multiplier short) from the 2nd.
 */
const SGOV_POINTS: [string, number][] = [
  ["2026-08-31", 100.98519427],
  ["2026-09-01", 100.95459352],
  ["2026-09-02", 100.405],
  ["2026-09-03", 100.425],
  ["2026-09-04", 100.465],
];
const SGOV_MULTIPLIER = 1.005101770003215;
const stamp = (day: string) => Date.parse(`${day}T21:30:00Z`) / 1000;

function llamaChart(points: Record<string, [string, number][]>) {
  return vi.fn(async (url: string | URL) => {
    const coins: Record<string, { prices: { timestamp: number; price: number }[] }> = {};
    for (const [symbol, series] of Object.entries(points)) {
      const key = `coingecko:${MARKET_ID_BY_SYMBOL[symbol]}`;
      if (String(url).includes(key)) coins[key] = { prices: series.map(([day, price]) => ({ timestamp: stamp(day), price })) };
    }
    return new Response(JSON.stringify({ coins }));
  });
}

const sgovOnly: MultiplierReader = async (symbols) => {
  const histories: Record<string, MultiplierHistory> = {};
  if (symbols.includes("SGOV")) {
    histories.SGOV = {
      current: SGOV_MULTIPLIER,
      changes: [{ from: 1.0029815193467666, to: SGOV_MULTIPLIER, effectiveAt: 1788220826 }],
    };
  }
  return { histories, failures: [] };
};

afterEach(() => vi.unstubAllGlobals());

describe("stored marks from DefiLlama", () => {
  it("are what one token was worth, on both sides of DefiLlama's switch", async () => {
    vi.stubGlobal("fetch", llamaChart({ SGOV: SGOV_POINTS, TSLA: [["2026-09-03", 356.8]] }));
    const { points, failures } = await fetchMarkPoints(["SGOV", "TSLA"], "2026-08-31", 5, sgovOnly);
    // TSLA has no multiplier history in this reader: it is not stored as a token price.
    expect(failures).toEqual(["TSLA: dividend multiplier unread"]);
    expect(points.TSLA).toBeUndefined();
    const prices = points.SGOV.map((point) => point.price);
    expect(prices.slice(0, 2)).toEqual([100.98519427, 100.95459352]);
    expect(prices[2]).toBeCloseTo(100.405 * SGOV_MULTIPLIER, 8);
    // No false 0.54% drop the night DefiLlama changed what it quotes.
    expect(Math.abs(prices[2] / prices[1] - 1)).toBeLessThan(0.0005);
  });

  it("store Gold and Bitcoin as DefiLlama prints them", async () => {
    const read = vi.fn<MultiplierReader>();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ coins: { "coingecko:bitcoin": { prices: [{ timestamp: stamp("2026-09-03"), price: 90000 }] } } }))));
    const { points } = await fetchMarkPoints(["BTC"], "2026-09-03", 1, read);
    expect(points.BTC[0].price).toBe(90000);
    expect(read).not.toHaveBeenCalled();
  });
});

describe("the board's line", () => {
  it("draws the token, so the switch reads as a Treasury fund's quiet day", async () => {
    vi.useFakeTimers({ now: Date.parse("2026-09-05T12:00:00Z"), toFake: ["Date"] });
    try {
      vi.stubGlobal("fetch", llamaChart({ SGOV: SGOV_POINTS }));
      const { performance } = await loadPerformance(sgovOnly);
      const series = performance.SGOV.series!;
      expect(series[2]).toBeCloseTo(100.405 * SGOV_MULTIPLIER, 8);
      expect(performance.SGOV.changePct).toBeCloseTo((100.465 / 100.425 - 1) * 100, 8);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps DefiLlama's quotes when the chain cannot be read, and says so", async () => {
    vi.stubGlobal("fetch", llamaChart({ SGOV: SGOV_POINTS }));
    const failing: MultiplierReader = async () => {
      throw new Error("down");
    };
    const { performance, reason } = await loadPerformance(failing);
    expect(performance.SGOV.series![2]).toBe(100.405);
    expect(reason).toContain("dividend multiplier unread for SGOV");
  });
});
