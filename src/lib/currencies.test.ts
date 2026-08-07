import { describe, expect, it } from "vitest";

import { resolveMoney, type FxRates } from "@/lib/currencies";

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
