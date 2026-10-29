import { describe, expect, it } from "vitest";
import { allocationSegments, OTHER_TONE } from "@/lib/allocation";

const h = (key: string, valueUsd: number) => ({ key, name: key.toUpperCase(), valueUsd });
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("allocationSegments", () => {
  it("orders largest first with stepping tones", () => {
    const { segments, toneByKey } = allocationSegments([h("a", 10), h("c", 60), h("b", 30)]);
    expect(segments.map((s) => s.keys[0])).toEqual(["c", "b", "a"]);
    expect(segments.map((s) => s.tone)).toEqual([0, 1, 2]);
    expect(segments.map((s) => s.percent)).toEqual([60, 30, 10]);
    expect(toneByKey).toEqual({ c: 0, b: 1, a: 2 });
  });

  it("caps named segments at five and merges the rest into Other", () => {
    const { segments, toneByKey } = allocationSegments(
      [h("a", 30), h("b", 25), h("c", 15), h("d", 12), h("e", 8), h("f", 5), h("g", 5)],
      "Other",
    );
    expect(segments).toHaveLength(6);
    const other = segments[5];
    expect(other.name).toBe("Other");
    expect(other.keys.sort()).toEqual(["f", "g"]);
    expect(other.tone).toBe(OTHER_TONE);
    expect(toneByKey.f).toBe(OTHER_TONE);
  });

  it("merges holdings under 2 percent into Other", () => {
    const { segments } = allocationSegments([h("a", 50), h("b", 49), h("c", 0.5), h("d", 0.5)]);
    expect(segments.map((s) => s.name)).toEqual(["A", "B", "Other"]);
    expect(segments[2].keys.sort()).toEqual(["c", "d"]);
  });

  it("names a single leftover holding instead of calling it Other", () => {
    const { segments, toneByKey } = allocationSegments([h("a", 60), h("b", 39), h("c", 1)]);
    expect(segments.map((s) => s.name)).toEqual(["A", "B", "C"]);
    expect(segments[2].tone).toBe(OTHER_TONE);
    expect(toneByKey.c).toBe(OTHER_TONE);
  });

  it("makes whole percents that add to 100", () => {
    const { segments } = allocationSegments([h("a", 1), h("b", 1), h("c", 1)]);
    expect(sum(segments.map((s) => s.percent))).toBe(100);
    const odd = allocationSegments([h("a", 33.3), h("b", 33.3), h("c", 33.4), h("d", 7), h("e", 0.1)]);
    expect(sum(odd.segments.map((s) => s.percent))).toBe(100);
  });

  it("returns nothing for fewer than two holdings", () => {
    expect(allocationSegments([]).segments).toEqual([]);
    expect(allocationSegments([h("a", 10)]).segments).toEqual([]);
  });

  it("returns nothing for a zero total", () => {
    expect(allocationSegments([h("a", 0), h("b", 0)]).segments).toEqual([]);
  });

  it("returns nothing when a value is not finite or is negative", () => {
    expect(allocationSegments([h("a", 10), h("b", Number.NaN)]).segments).toEqual([]);
    expect(allocationSegments([h("a", 10), h("b", Infinity)]).segments).toEqual([]);
    expect(allocationSegments([h("a", 10), h("b", -1)]).segments).toEqual([]);
  });
});
