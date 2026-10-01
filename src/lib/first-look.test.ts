import { describe, expect, it } from "vitest";
import {
  FIRST_LOOK_ABOUT_FLOOR,
  FIRST_LOOK_SYMBOLS,
  firstLookSymbols,
  judgeToday,
  lookStateFor,
  sameNewYorkDay,
  type FirstLookResponse,
} from "@/lib/first-look";
import type { NewsItem } from "@/lib/news";

// 16:00 UTC, noon in New York.
const NOW = Date.UTC(2026, 9, 1, 16);
const HOUR = 60 * 60 * 1000;

function headline(over: Partial<NewsItem> = {}): NewsItem {
  return {
    title: "Nvidia agrees to supply chips for OpenAI's new data centres",
    url: "https://example.com/a",
    publishedAt: NOW - 2 * HOUR,
    source: "Reuters",
    symbol: "NVDA",
    name: "NVIDIA",
    verdict: "fact",
    about: 0.92,
    ...over,
  };
}

describe("judgeToday", () => {
  it("is in today's news when one of today's headlines passes every bar", () => {
    expect(judgeToday({ symbol: "NVDA", items: [headline()], read: 3, now: NOW })).toEqual({ looked: true, inNews: true });
    expect(judgeToday({ symbol: "NVDA", items: [headline({ verdict: "material" })], read: 1, now: NOW }).inNews).toBe(true);
  });

  it("looked and found nothing when none of today's headlines passes", () => {
    for (const item of [
      headline({ verdict: "analysis" }),
      headline({ about: FIRST_LOOK_ABOUT_FLOOR - 0.01 }),
      headline({ title: "Goldman Adds Nvidia to Conviction List" }),
      headline({ title: "Should You Buy Nvidia?" }),
      headline({ symbol: "AAPL" }),
    ]) {
      expect(judgeToday({ symbol: "NVDA", items: [item], read: 2, now: NOW })).toEqual({ looked: true, inNews: false });
    }
  });

  it("counts only today in New York, not yesterday's news", () => {
    // 03:00 UTC on the 1st is the evening of the 30th in New York.
    const yesterday = headline({ publishedAt: Date.UTC(2026, 9, 1, 3) });
    expect(judgeToday({ symbol: "NVDA", items: [yesterday], read: 4, now: NOW })).toEqual({ looked: true, inNews: false });
    expect(judgeToday({ symbol: "NVDA", items: [headline({ publishedAt: NOW + HOUR })], read: 1, now: NOW }).inNews).toBe(false);
  });

  it("did not look when Jev read nothing, or left any of today's headlines unread", () => {
    expect(judgeToday({ symbol: "NVDA", items: [], read: 0, now: NOW })).toEqual({ looked: false, inNews: false });
    expect(judgeToday({ symbol: "NVDA", items: [headline()], read: 0, now: NOW }).looked).toBe(false);
    const unread = headline({ title: "Unread", verdict: undefined, about: undefined });
    expect(judgeToday({ symbol: "NVDA", items: [headline(), unread], read: 1, now: NOW })).toEqual({ looked: false, inNews: false });
  });

  it("looked when Jev read the feed and today brought no headline at all", () => {
    expect(judgeToday({ symbol: "NVDA", items: [], read: 5, now: NOW })).toEqual({ looked: true, inNews: false });
  });
});

describe("lookStateFor", () => {
  const data = (looks: FirstLookResponse["looks"], over: Partial<FirstLookResponse> = {}): FirstLookResponse => ({
    judged: true,
    asOf: NOW - HOUR,
    looks,
    ...over,
  });

  it("holds the place while loading, and says nothing when nothing came", () => {
    expect(lookStateFor({ symbol: "NVDA", data: undefined, loading: true, now: NOW })).toEqual({ kind: "loading" });
    expect(lookStateFor({ symbol: "NVDA", data: undefined, loading: false, now: NOW })).toEqual({ kind: "hidden" });
  });

  it("says nothing without Jev, for a listing not read, or for one not looked at with no move", () => {
    expect(lookStateFor({ symbol: "NVDA", data: data({}, { judged: false }), loading: false, now: NOW }).kind).toBe("hidden");
    expect(lookStateFor({ symbol: "AMZN", data: data({}), loading: false, now: NOW }).kind).toBe("hidden");
    expect(lookStateFor({ symbol: "NVDA", data: data({ NVDA: { looked: false, inNews: false } }), loading: false, now: NOW }).kind).toBe("hidden");
  });

  it("shows a large move even where the news was not looked at", () => {
    const state = lookStateFor({ symbol: "NVDA", data: data({ NVDA: { looked: false, inNews: false, movePct: -4.1 } }), loading: false, now: NOW });
    expect(state).toEqual({ kind: "shown", look: { looked: false, inNews: false, movePct: -4.1 } });
  });

  it("never says today of an answer from an earlier New York day", () => {
    const stale = data({ NVDA: { looked: true, inNews: true } }, { asOf: Date.UTC(2026, 9, 1, 3) });
    expect(lookStateFor({ symbol: "NVDA", data: stale, loading: false, now: NOW }).kind).toBe("hidden");
  });

  it("knows a New York day", () => {
    expect(sameNewYorkDay(Date.UTC(2026, 9, 1, 3), Date.UTC(2026, 8, 30, 23))).toBe(true);
    expect(sameNewYorkDay(Date.UTC(2026, 9, 1, 5), Date.UTC(2026, 9, 1, 3))).toBe(false);
  });
});

describe("firstLookSymbols", () => {
  it("adds one stock outside the examples, and nothing that is not a stock on Berth", () => {
    expect(firstLookSymbols()).toEqual([...FIRST_LOOK_SYMBOLS]);
    expect(firstLookSymbols("amzn")).toEqual([...FIRST_LOOK_SYMBOLS, "AMZN"]);
    expect(firstLookSymbols("NVDA")).toEqual([...FIRST_LOOK_SYMBOLS]);
    expect(firstLookSymbols("SGOV")).toEqual([...FIRST_LOOK_SYMBOLS]);
    expect(firstLookSymbols("DROP TABLE")).toEqual([...FIRST_LOOK_SYMBOLS]);
  });
});
