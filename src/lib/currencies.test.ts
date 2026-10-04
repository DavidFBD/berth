import { describe, expect, it } from "vitest";

import { fxRateStale, resolveMoney, type FxRates } from "@/lib/currencies";

/** One fixed payload exercises every branch: good, zero, and negative rates. */
const FX: FxRates = {
  USD: 1,
  EUR: 0.92,
  JPY: 0,
  KRW: -1350,
};

describe("resolveMoney", () => {
  it("uses the chosen currency when its rate is present and positive", () => {
    expect(resolveMoney("EUR", FX)).toEqual({ currency: "EUR", rate: 0.92 });
  });

  it("keeps USD at rate 1", () => {
    expect(resolveMoney("USD", FX)).toEqual({ currency: "USD", rate: 1 });
  });

  it("falls back to USD when the chosen currency has no rate", () => {
    expect(resolveMoney("GBP", FX)).toEqual({ currency: "USD", rate: 1 });
  });

  it("falls back to USD when the rate is zero", () => {
    expect(resolveMoney("JPY", FX)).toEqual({ currency: "USD", rate: 1 });
  });

  it("falls back to USD when the rate is negative", () => {
    expect(resolveMoney("KRW", FX)).toEqual({ currency: "USD", rate: 1 });
  });

  it("falls back to USD before any rates have arrived", () => {
    expect(resolveMoney("EUR", undefined)).toEqual({
      currency: "USD",
      rate: 1,
    });
  });
});

describe("fxRateStale", () => {
  it("calls Friday's rate fresh on Friday evening", () => {
    expect(fxRateStale("2026-10-02", new Date("2026-10-02T20:00:00Z"))).toBe(false);
  });

  it("calls yesterday's rate fresh until the next fixing time", () => {
    expect(fxRateStale("2026-10-01", new Date("2026-10-02T14:00:00Z"))).toBe(false);
  });

  it("names Friday's rate on Sunday", () => {
    expect(fxRateStale("2026-10-02", new Date("2026-10-04T10:00:00Z"))).toBe(true);
  });

  it("never calls an unknown or malformed date stale", () => {
    expect(fxRateStale(undefined)).toBe(false);
    expect(fxRateStale("Friday")).toBe(false);
  });
});
