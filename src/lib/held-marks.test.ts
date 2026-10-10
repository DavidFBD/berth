import { describe, expect, it } from "vitest";
import { TOKEN_LISTINGS } from "@/lib/listings";
import { HELD_MARKS_SHOWN, heldMarks } from "./held-marks";

const symbols = TOKEN_LISTINGS.map((listing) => listing.symbol);

describe("the legend's holding marks", () => {
  it("shows what is held in the registry's order, never by size", () => {
    const [a, b, c] = symbols;
    expect(heldMarks([c, a, b]).shown).toEqual([a, b, c]);
  });

  it("caps at five and counts the rest", () => {
    const answer = heldMarks(symbols.slice(0, 8));
    expect(answer.shown).toHaveLength(HELD_MARKS_SHOWN);
    expect(answer.more).toBe(3);
  });

  it("shows a sixth mark rather than a +1", () => {
    expect(heldMarks(symbols.slice(0, 6))).toEqual({ shown: symbols.slice(0, 6), more: 0 });
  });

  it("is empty for nothing held, and folds repeats", () => {
    expect(heldMarks(undefined)).toEqual({ shown: [], more: 0 });
    expect(heldMarks([symbols[0], symbols[0]])).toEqual({ shown: [symbols[0]], more: 0 });
  });
});
