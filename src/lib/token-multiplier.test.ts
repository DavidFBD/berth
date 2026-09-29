import { describe, expect, it } from "vitest";
import {
  LLAMA_SHARE_QUOTES_FROM_MS,
  llamaQuotesShares,
  llamaTokenPrice,
  multiplierAt,
  multiplierFromFixed,
  type MultiplierHistory,
} from "@/lib/token-multiplier";

// SGOV's three UIMultiplierUpdated events on Robinhood Chain, as read 2026-09-29.
const SGOV: MultiplierHistory = {
  current: multiplierFromFixed(1005101770003214918n),
  changes: [
    { from: 1, to: multiplierFromFixed(1000957519890990718n), effectiveAt: 1783541672 },
    { from: multiplierFromFixed(1002981519346766532n), to: multiplierFromFixed(1005101770003214918n), effectiveAt: 1788220826 },
    { from: multiplierFromFixed(1000957519890990718n), to: multiplierFromFixed(1002981519346766532n), effectiveAt: 1786115424 },
  ],
};
const at = (iso: string) => Date.parse(iso);

describe("the multiplier's fixed point", () => {
  it("reads eighteen decimals without losing the digits that matter", () => {
    expect(multiplierFromFixed(1005101770003214918n)).toBeCloseTo(1.005101770003215, 15);
    expect(multiplierFromFixed(10n ** 18n)).toBe(1);
    expect(multiplierFromFixed(2n * 10n ** 18n + 5n * 10n ** 17n)).toBe(2.5);
  });
});

describe("the multiplier at a moment", () => {
  it("takes the last change in effect, in whatever order the events came", () => {
    expect(multiplierAt(SGOV, at("2026-07-08T00:00:00Z"))).toBe(1);
    expect(multiplierAt(SGOV, at("2026-07-20T21:30:00Z"))).toBeCloseTo(1.00095752, 8);
    expect(multiplierAt(SGOV, at("2026-08-20T21:30:00Z"))).toBeCloseTo(1.00298152, 8);
    // Set at 23:50 UTC on 08-31, in force from 00:00:26 UTC on 09-01.
    expect(multiplierAt(SGOV, at("2026-08-31T21:30:00Z"))).toBeCloseTo(1.00298152, 8);
    expect(multiplierAt(SGOV, at("2026-09-01T00:00:26Z"))).toBeCloseTo(1.00510177, 8);
    expect(multiplierAt(SGOV, at("2026-09-28T21:30:00Z"))).toBeCloseTo(1.00510177, 8);
  });

  it("is the current one when nothing changed inside the window", () => {
    expect(multiplierAt({ current: 1.0005660800610925, changes: [] }, at("2026-09-02T21:30:00Z"))).toBe(1.0005660800610925);
  });

  it("is the old one before a change announced ahead of its time", () => {
    const pending: MultiplierHistory = {
      current: 1.0007751591646306,
      changes: [{ from: 1.0007751591646306, to: 1.0015, effectiveAt: at("2026-10-01T00:00:00Z") / 1000 }],
    };
    expect(multiplierAt(pending, at("2026-09-30T21:30:00Z"))).toBe(1.0007751591646306);
    expect(multiplierAt(pending, at("2026-10-01T21:30:00Z"))).toBe(1.0015);
  });
});

describe("a DefiLlama price as a token's", () => {
  it("multiplies a share quote from 2026-09-02 13:05 UTC on, and leaves the token prints before it", () => {
    expect(llamaQuotesShares(LLAMA_SHARE_QUOTES_FROM_MS - 1)).toBe(false);
    expect(llamaQuotesShares(LLAMA_SHARE_QUOTES_FROM_MS)).toBe(true);
    // 09-01: DefiLlama printed the token itself.
    expect(llamaTokenPrice(100.95459352, at("2026-09-01T21:30:00Z"), SGOV)).toBe(100.95459352);
    // 09-29: DefiLlama 100.675 is the share; Robinhood bids the token at 101.1836 against a share bid of 100.67.
    expect(llamaTokenPrice(100.675, at("2026-09-29T14:44:18Z"), SGOV)).toBeCloseTo(101.1886, 4);
    expect(llamaTokenPrice(100.67, at("2026-09-29T14:44:18Z"), SGOV)).toBeCloseTo(101.1836, 4);
  });

  it("puts right the false drop on the day DefiLlama switched", () => {
    const before = llamaTokenPrice(100.95459352, at("2026-09-01T21:30:00Z"), SGOV);
    const after = llamaTokenPrice(100.405, at("2026-09-02T21:30:00Z"), SGOV);
    // Unadjusted the line fell 0.54% overnight; a Treasury bill fund does not.
    expect(100.405 / 100.95459352 - 1).toBeLessThan(-0.005);
    expect(Math.abs(after / before - 1)).toBeLessThan(0.0005);
  });
});
