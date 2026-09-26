import { describe, expect, it } from "vitest";
import { units, usd } from "./text";

describe("numbers for an assistant", () => {
  it("writes dollars with the sign in front, and tiny amounts as tiny", () => {
    expect(usd(1234.5)).toBe("$1,234.50");
    expect(usd(-12)).toBe("-$12.00");
    expect(usd(0.5)).toBe("$0.5000");
    expect(usd(-0.25)).toBe("-$0.2500");
    expect(usd(0.00001)).toBe("<$0.0001");
    expect(usd(-0.00001)).toBe(">-$0.0001");
    expect(usd(0)).toBe("$0.00");
    expect(usd(null)).toBe("unknown");
  });

  it("never writes a tiny quantity as zero", () => {
    expect(units(0.5123456)).toBe("0.512346");
    expect(units(12)).toBe("12");
    expect(units(0.000000412345)).toBe("0.000000412");
    expect(units(0)).toBe("0");
  });
});
