import { describe, expect, it } from "vitest";
import { DUST_USD, isDust } from "./dust";

describe("isDust", () => {
  it("calls a sub-cent leftover dust", () => {
    expect(isDust(0.004)).toBe(true);
    expect(isDust(0)).toBe(true);
  });

  it("keeps anything at the threshold or above", () => {
    expect(isDust(DUST_USD)).toBe(false);
    expect(isDust(1)).toBe(false);
  });

  it("never calls an unpriced holding dust, since its worth is unknown", () => {
    expect(isDust(undefined)).toBe(false);
  });
});
