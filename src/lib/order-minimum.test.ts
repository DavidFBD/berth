import { describe, expect, it } from "vitest";
import { MIN_ORDER_LABEL, MIN_ORDER_USD, isTooSmallQuoteError } from "./order-minimum";
import { MIN_POUR_USD } from "./pour-amount";

describe("the order minimum", () => {
  it("is one number for every order", () => {
    expect(MIN_POUR_USD).toBe(MIN_ORDER_USD);
    expect(MIN_ORDER_LABEL).toBe("$1.50");
  });

  it("clears the solver's one dollar floor after the 0.4% fee", () => {
    expect(MIN_ORDER_USD * (1 - 0.004)).toBeGreaterThan(1.01);
  });

  it("knows the solver's too small answer from a missing route", () => {
    expect(isTooSmallQuoteError({ detail: { code: -4, message: "Input amount too low" } })).toBe(true);
    expect(isTooSmallQuoteError({ detail: { code: -5, message: "No path was found" } })).toBe(false);
    expect(isTooSmallQuoteError(undefined)).toBe(false);
    expect(isTooSmallQuoteError("Input amount too low")).toBe(false);
  });
});
