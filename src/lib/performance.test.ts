import { describe, expect, it } from "vitest";
import {
  changeDirection,
  chunkByPointBudget,
  formatPercentChange,
  percentChange,
  sparklinePath,
  tradingDayCloses,
  withoutSpikes,
} from "./performance";

describe("changeDirection", () => {
  it("calls a real move up or down", () => {
    expect(changeDirection(2.14)).toBe("up");
    expect(changeDirection(-3.7)).toBe("down");
  });

  it("calls a basis-point drift flat, so noise is never dressed as a gain", () => {
    expect(changeDirection(0.01)).toBe("flat");
    expect(changeDirection(-0.04)).toBe("flat");
    expect(changeDirection(0)).toBe("flat");
  });

  it("has no opinion without a number", () => {
    expect(changeDirection(undefined)).toBeUndefined();
    expect(changeDirection(Number.NaN)).toBeUndefined();
  });
});

describe("formatPercentChange", () => {
  it("signs a gain and a loss, but never a zero", () => {
    expect(formatPercentChange(2.14)).toBe("+2.14%");
    expect(formatPercentChange(-3.7)).toBe("-3.70%");
    expect(formatPercentChange(0)).toBe("0.00%");
  });

  it("returns nothing for a number that isn't one", () => {
    expect(formatPercentChange(Number.POSITIVE_INFINITY)).toBe("");
  });
});

describe("sparklinePath", () => {
  it("draws oldest to newest, left to right, with a rise going up", () => {
    const path = sparklinePath([1, 2], 100, 20, 0);
    // y is inverted: the low value sits at the bottom of the box.
    expect(path).toBe("M0 20 L100 0");
  });

  it("insets by half the stroke so the extremes are not clipped", () => {
    const path = sparklinePath([1, 2], 100, 20, 2);
    expect(path).toBe("M0 19 L100 1");
  });

  it("draws a flat run through the middle instead of dividing by zero", () => {
    expect(sparklinePath([5, 5, 5], 100, 20, 0)).toBe("M0 10 L50 10 L100 10");
  });

  it("refuses anything that cannot be a line", () => {
    expect(sparklinePath([1], 100, 20)).toBeUndefined();
    expect(sparklinePath([], 100, 20)).toBeUndefined();
    expect(sparklinePath([1, Number.NaN], 100, 20)).toBeUndefined();
    expect(sparklinePath([1, 2], 0, 20)).toBeUndefined();
  });
});

describe("chunkByPointBudget", () => {
  it("cuts thirteen listings over ninety days into three requests", () => {
    const listings = Array.from({ length: 13 }, (_, index) => index);
    const chunks = chunkByPointBudget(listings, 90, 500);
    expect(chunks.map((chunk) => chunk.length)).toEqual([5, 5, 3]);
    expect(chunks.flat()).toEqual(listings);
  });

  it("keeps every chunk inside the budget", () => {
    for (const span of [1, 7, 30, 90, 365]) {
      for (const chunk of chunkByPointBudget([1, 2, 3, 4, 5, 6], span, 500)) {
        expect(chunk.length * span).toBeLessThanOrEqual(500);
      }
    }
  });

  it("sends an item that cannot fit alone anyway, rather than dropping it", () => {
    expect(chunkByPointBudget([1, 2], 900, 500)).toEqual([[1], [2]]);
  });

  it("has nothing to send for an empty list", () => {
    expect(chunkByPointBudget([], 90, 500)).toEqual([]);
  });
});

describe("tradingDayCloses", () => {
  const at = (date: string, price: number) => ({
    timestamp: Date.parse(`${date}T12:50:00Z`) / 1000,
    price,
  });

  it("drops the weekend and holiday marks that faked a GameStop rally", () => {
    const { dates, values } = tradingDayCloses([
      at("2026-09-03", 19.1),
      at("2026-09-04", 19.5),
      at("2026-09-05", 34.44), // Saturday
      at("2026-09-06", 34.44), // Sunday
      at("2026-09-07", 34.44), // Labor Day
      at("2026-09-08", 19.4),
    ]);
    expect(dates).toEqual([
      "2026-09-03",
      "2026-09-04",
      "2026-09-08",
    ]);
    expect(values).toEqual([19.1, 19.5, 19.4]);
  });

  it("sorts oldest first and keeps one mark per day", () => {
    const { dates, values } = tradingDayCloses([
      at("2026-09-16", 213.82),
      at("2026-09-15", 212.53),
      { timestamp: Date.parse("2026-09-16T13:10:00Z") / 1000, price: 214.0 },
    ]);
    expect(dates).toEqual(["2026-09-15", "2026-09-16"]);
    expect(values).toEqual([212.53, 214.0]);
  });

  it("ignores a price that cannot be one", () => {
    const { values } = tradingDayCloses([
      at("2026-09-15", 0),
      at("2026-09-16", Number.NaN),
    ]);
    expect(values).toEqual([]);
  });
});

describe("percentChange", () => {
  it("measures a rise and a fall", () => {
    expect(percentChange(100, 102.14)).toBeCloseTo(2.14, 10);
    expect(percentChange(100, 96.3)).toBeCloseTo(-3.7, 10);
  });

  it("has no answer without two usable prices", () => {
    expect(percentChange(undefined, 100)).toBeUndefined();
    expect(percentChange(0, 100)).toBeUndefined();
    expect(percentChange(100, Number.NaN)).toBeUndefined();
  });
});

describe("withoutSpikes", () => {
  it("drops the Sandisk mark that printed four times the share price", () => {
    const { dates, values } = withoutSpikes(
      ["2026-07-15", "2026-07-16", "2026-07-17"],
      [1450, 6972.01, 1490],
    );
    expect(dates).toEqual(["2026-07-15", "2026-07-17"]);
    expect(values).toEqual([1450, 1490]);
  });

  it("drops a mark that collapsed and came straight back", () => {
    // Micron on 2026-07-20, about forty percent under the days either side.
    expect(withoutSpikes(["a", "b", "c"], [900, 533.85, 890]).values).toEqual([
      900, 890,
    ]);
  });

  it("keeps a real gap, because a step persists into the next day", () => {
    // A 25% earnings jump: the day after stays up, so the midpoint moves too.
    const { values } = withoutSpikes(["a", "b", "c"], [100, 125, 127]);
    expect(values).toEqual([100, 125, 127]);
  });

  it("keeps the quiet day before a real jump", () => {
    // The midpoint of 100 and 260 is 180, which would have condemned the
    // innocent 101. The median of the three is 101, so it stays.
    expect(withoutSpikes(["a", "b", "c"], [100, 101, 260]).values).toEqual([
      100, 101, 260,
    ]);
  });

  it("keeps the newest close, which cannot yet be told from news", () => {
    const { values } = withoutSpikes(["a", "b", "c", "d"], [100, 101, 102, 260]);
    expect(values).toEqual([100, 101, 102, 260]);
  });

  it("leaves a series too short to judge alone", () => {
    expect(withoutSpikes(["a", "b"], [1, 900]).values).toEqual([1, 900]);
  });
});
