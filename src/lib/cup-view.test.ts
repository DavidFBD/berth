import { describe, expect, it } from "vitest";

import {
  computeCupView,
  SAWTOOTH_NOISE_BAND,
  type CupViewInput,
} from "./cup-view";
import { USD_STEAM_BANDS } from "./vaults-meta";

/** 1% in RAY (1e27 = 100%). */
const RAY_PERCENT = 10n ** 25n;

/** Token-unit fallback bands, shaped like a real VaultMeta's. */
const TOKEN_BANDS: [number, number, number] = [0.02, 0.2, 2];

function view(overrides: Partial<CupViewInput> = {}) {
  return computeCupView({
    steeping: 0,
    hasPosition: true,
    assetPrice: undefined,
    aprRay: undefined,
    steamThresholds: TOKEN_BANDS,
    earned: undefined,
    ...overrides,
  });
}

describe("steam bands", () => {
  it("an empty cup neither steams nor fills", () => {
    const empty = view({ hasPosition: false });
    expect(empty.steamLevel).toBe(0);
    expect(empty.fill).toBe(0);
  });

  it("steps through the USD bands by worth when the asset is priced", () => {
    const [b1, b2, b3] = USD_STEAM_BANDS;
    // Price of 2 so a token-vs-USD mixup cannot cancel out.
    const at = (usd: number) =>
      view({ steeping: usd / 2, assetPrice: 2 }).steamLevel;
    expect(at(b1 - 0.01)).toBe(1);
    expect(at(b1)).toBe(2);
    expect(at(b2 - 0.01)).toBe(2);
    expect(at(b2)).toBe(3);
    expect(at(b3 - 0.01)).toBe(3);
    expect(at(b3)).toBe(4);
  });

  it("steps through the token-unit thresholds when unpriced", () => {
    const [t1, t2, t3] = TOKEN_BANDS;
    const at = (tokens: number) => view({ steeping: tokens }).steamLevel;
    expect(at(t1 / 2)).toBe(1);
    expect(at(t1)).toBe(2);
    expect(at(t2)).toBe(3);
    expect(at(t3)).toBe(4);
  });

  it("a priced asset heats by USD even where token units would say otherwise", () => {
    // 3 tokens clears the whole token ladder, but at $2 it is only $6.
    expect(view({ steeping: 3 }).steamLevel).toBe(4);
    expect(view({ steeping: 3, assetPrice: 2 }).steamLevel).toBe(1);
  });
});

describe("fill", () => {
  it("floors at a quarter cup the moment anything steeps", () => {
    expect(view({ steeping: 1e-9 }).fill).toBeCloseTo(0.25, 6);
  });

  it("reaches exactly full at the top band and caps there", () => {
    expect(view({ steeping: TOKEN_BANDS[2] }).fill).toBe(1);
    expect(view({ steeping: TOKEN_BANDS[2] * 100 }).fill).toBe(1);
  });

  it("interpolates between floor and full", () => {
    // Half of t3: 0.25 + 0.5 * 0.75.
    expect(view({ steeping: TOKEN_BANDS[2] / 2 }).fill).toBeCloseTo(0.625, 9);
  });

  it("fills by USD worth when priced", () => {
    const usd = USD_STEAM_BANDS[2] / 2;
    expect(view({ steeping: usd / 2, assetPrice: 2 }).fill).toBeCloseTo(
      0.625,
      9,
    );
  });
});

describe("sawtooth suppression", () => {
  // $1000 pot: the noise band is exactly $1.
  const pot = { steeping: 1000, assetPrice: 1, aprRay: 5n * RAY_PERCENT };
  const band = 1000 * SAWTOOTH_NOISE_BAND;

  it("suppresses a negative just inside the band", () => {
    expect(
      view({ ...pot, earned: -(band - 0.0001) }).sawtoothSuppressed,
    ).toBe(true);
  });

  it("shows a negative exactly at the band boundary", () => {
    expect(view({ ...pot, earned: -band }).sawtoothSuppressed).toBe(false);
  });

  it("shows a negative just outside the band", () => {
    expect(
      view({ ...pot, earned: -(band + 0.0001) }).sawtoothSuppressed,
    ).toBe(false);
  });

  it("never suppresses when the rate itself is negative", () => {
    expect(
      view({ ...pot, aprRay: -5n * RAY_PERCENT, earned: -(band / 10) })
        .sawtoothSuppressed,
    ).toBe(false);
  });

  it("never suppresses a gain or an unanchored figure", () => {
    expect(view({ ...pot, earned: band / 10 }).sawtoothSuppressed).toBe(false);
    expect(view({ ...pot, earned: undefined }).sawtoothSuppressed).toBe(false);
  });

  it("measures the band against the token pot when unpriced", () => {
    const unpriced = { steeping: 1000, aprRay: 5n * RAY_PERCENT };
    expect(
      view({ ...unpriced, earned: -(band - 0.0001) }).sawtoothSuppressed,
    ).toBe(true);
    expect(view({ ...unpriced, earned: -band }).sawtoothSuppressed).toBe(false);
  });
});

describe("unit switching", () => {
  const base = {
    steeping: 100,
    assetPrice: 2,
    aprRay: 10n * RAY_PERCENT,
    earned: 0.5,
  };

  it("speaks USD when the asset is priced", () => {
    const priced = view(base);
    expect(priced.priced).toBe(true);
    expect(priced.steepingUsd).toBe(200);
    expect(priced.earnedDisplay).toBe(1);
    expect(priced.earnedPerYear).toBe(20);
  });

  it("falls back to token units when unpriced", () => {
    const unpriced = view({ ...base, assetPrice: undefined });
    expect(unpriced.priced).toBe(false);
    expect(unpriced.steepingUsd).toBeUndefined();
    expect(unpriced.yearTotalUsd).toBeUndefined();
    expect(unpriced.earnedDisplay).toBe(0.5);
    expect(unpriced.earnedPerYear).toBe(10);
  });
});

describe("year-ahead figure", () => {
  it("is principal plus a year at the current rate", () => {
    const v = view({ steeping: 100, aprRay: 10n * RAY_PERCENT });
    expect(v.yearTotal).toBeCloseTo(110, 9);
    expect(v.yearTotalUsd).toBeUndefined();
  });

  it("carries the same figure in USD when priced", () => {
    const v = view({ steeping: 100, assetPrice: 2, aprRay: 10n * RAY_PERCENT });
    expect(v.yearTotal).toBeCloseTo(110, 9);
    expect(v.yearTotalUsd).toBeCloseTo(220, 9);
  });

  it("promises nothing while the rate is unknown", () => {
    const v = view({ steeping: 100 });
    expect(v.yearTotal).toBe(100);
    expect(v.earnedPerYear).toBe(0);
    expect(v.aprNegative).toBe(false);
  });

  it("shrinks the pot under a negative rate", () => {
    const v = view({ steeping: 100, aprRay: -10n * RAY_PERCENT });
    expect(v.aprNegative).toBe(true);
    expect(v.yearTotal).toBeCloseTo(90, 9);
  });
});
