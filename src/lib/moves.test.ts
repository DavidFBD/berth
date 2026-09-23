import { describe, expect, it } from "vitest";
import { candidatePosts, isNotableMove, moveWords, newsWindow, typicalMovePct } from "@/lib/moves";

/** Thirty quiet days of half-percent wiggles around 100. */
const quiet = Array.from({ length: 30 }, (_, index) => 100 * (1 + (index % 2 === 0 ? 0.005 : -0.005)));

describe("typicalMovePct", () => {
  it("is the median size of a day's move", () => {
    expect(typicalMovePct(quiet)).toBeCloseTo(1, 1);
  });

  it("needs enough history to say", () => {
    expect(typicalMovePct([100, 101, 102])).toBeUndefined();
  });
});

describe("isNotableMove", () => {
  it("takes a move twice the listing's own typical day", () => {
    expect(isNotableMove([...quiet, 103], 3)).toBe(true);
  });

  it("leaves an ordinary day alone", () => {
    expect(isNotableMove([...quiet, 101], 1.2)).toBe(false);
  });

  it("never calls a sub-percent move notable, however quiet the listing", () => {
    const flat = Array.from({ length: 30 }, (_, index) => 100 + index * 0.0001);
    expect(isNotableMove([...flat, 100.9], 0.9)).toBe(false);
  });

  it("has nothing to say without a change", () => {
    expect(isNotableMove(quiet, undefined)).toBe(false);
  });
});

describe("candidatePosts", () => {
  const post = (id: string, symbol: string, publishedAt: number) => ({ id, symbol, publishedAt });
  const window = newsWindow("2026-09-22");

  it("offers the listing's substantive posts from around the move, best first", () => {
    const at = Date.parse("2026-09-22T08:00:00Z");
    const posts = [post("a", "GME", at), post("b", "GME", at), post("c", "NVDA", at), post("d", "GME", at - 5 * 86_400_000)];
    const substance = new Map([["a", 1.2], ["b", 1.5], ["c", 1.6], ["d", 1.6]]);
    expect(candidatePosts(posts, substance, "GME", window, 1.15).map((p) => p.id)).toEqual(["b", "a"]);
  });

  it("drops posts Jev did not read as news", () => {
    const at = Date.parse("2026-09-22T08:00:00Z");
    expect(candidatePosts([post("a", "GME", at)], new Map([["a", 0.9]]), "GME", window, 1.15)).toEqual([]);
  });
});

describe("moveWords", () => {
  it("says the move in words, not figures", () => {
    expect(moveWords(3.4)).toBe("rose noticeably");
    expect(moveWords(-6)).toBe("fell sharply");
  });
});
