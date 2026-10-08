import { describe, expect, it } from "vitest";
import {
  FIRST_LOOK_ABOUT_FLOOR,
  FIRST_LOOK_SYMBOLS,
  firstBuyProposals,
  firstLookSymbols,
  judgeRecent,
  newsOf,
  lookStateFor,
  sameNewYorkDay,
  windowStart,
  type FirstLookResponse,
} from "@/lib/first-look";
import { COPY } from "@/lib/copy";
import type { NewsItem } from "@/lib/news";
import type { StoryCard } from "@/lib/news-stories";

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

/** The drawer's card a look attaches (lib/news-stories), for one listing. */
function story(symbol = "NVDA", over: Partial<StoryCard> = {}): StoryCard {
  return {
    id: `s${symbol.length}`,
    storyId: symbol.length,
    kind: "article",
    title: "Nvidia agrees to supply chips for OpenAI's new data centres",
    url: "https://example.com/a",
    publisher: "Reuters",
    publishedAt: NOW - 2 * HOUR,
    symbol,
    name: symbol,
    symbols: [symbol],
    verdict: "fact",
    about: 0.92,
    readings: { [symbol]: { verdict: "fact", about: 0.92 } },
    alsoReportedBy: [],
    alsoOnX: [],
    ...over,
  };
}

describe("judgeRecent", () => {
  const judge = (items: NewsItem[], now = NOW) => {
    const said: Partial<ReturnType<typeof judgeRecent>> = judgeRecent({ symbol: "NVDA", items, now });
    delete said.lead;
    return said;
  };
  const silent = { looked: false, inNews: false, inNewsWeek: false };
  const today = { looked: true, inNews: true, inNewsWeek: true };
  const weekOnly = { looked: false, inNews: false, inNewsWeek: true };
  const yesterday = headline({ publishedAt: Date.UTC(2026, 9, 1, 3) }); // the evening of the 30th in New York

  it("is in today's news when one of today's headlines passes every bar", () => {
    expect(judge([headline()])).toEqual(today);
    expect(judge([headline({ verdict: "material" })]).inNews).toBe(true);
  });

  it("says no news line, never nothing, when nothing passed or the week was empty", () => {
    for (const item of [
      headline({ verdict: "analysis" }),
      headline({ about: FIRST_LOOK_ABOUT_FLOOR - 0.01 }),
      headline({ title: "Goldman Adds Nvidia to Conviction List" }),
      headline({ title: "Should You Buy Nvidia?" }),
      headline({ symbol: "AAPL" }),
    ]) {
      expect(judge([item])).toEqual(silent);
    }
    expect(judge([])).toEqual(silent);
  });

  it("says the week, never today, of a story from an earlier New York day", () => {
    expect(judge([yesterday])).toEqual(weekOnly);
    // Today wins when both passed.
    expect(judge([headline(), yesterday])).toEqual(today);
  });

  it("keeps inNews and looked as an older page reads them: today, or silent", () => {
    // A page from before the week line says "in today's news" for looked and inNews, and
    // "Nothing in today's news" for looked alone. The second must never come.
    for (const items of [[headline()], [yesterday], [headline({ verdict: "analysis" })], []]) {
      const look = judge(items);
      expect(look.looked).toBe(look.inNews);
    }
  });

  it("keeps Friday's news through the weekend: the window rolls, it does not empty at midnight", () => {
    // Sunday 2026-10-04, 08:00 in New York; Friday's story at 18:07.
    const friday = headline({ publishedAt: Date.UTC(2026, 9, 2, 22, 7), verdict: "material", about: 0.97 });
    const sundayOpinion = headline({ publishedAt: Date.UTC(2026, 9, 4, 9, 20), verdict: "analysis", about: 0.09 });
    expect(judge([sundayOpinion, friday], Date.UTC(2026, 9, 4, 12))).toEqual(weekOnly);
  });

  it("counts today and the six New York days before it, and nothing from the future", () => {
    // NOW is Thursday 1 October, noon in New York; the window opens at midnight on Friday 25 September (04:00 UTC).
    expect(judge([headline({ publishedAt: Date.UTC(2026, 8, 25, 3, 59) })])).toEqual(silent);
    expect(judge([headline({ publishedAt: Date.UTC(2026, 8, 25, 4, 1) })]).inNewsWeek).toBe(true);
    expect(judge([headline({ publishedAt: NOW + HOUR })])).toEqual(silent);
  });

  it("attaches the newest headline that passed, and none when nothing did", () => {
    const older = headline({ title: "Nvidia files its quarterly report", publishedAt: NOW - 30 * HOUR });
    const newer = headline({ title: "Nvidia opens a plant in Arizona", publishedAt: NOW - HOUR });
    const advice = headline({ title: "Should You Buy Nvidia?", publishedAt: NOW - 10 * 60 * 1000 });
    expect(judgeRecent({ symbol: "NVDA", items: [older, newer, advice], now: NOW }).lead).toBe(newer);
    expect(judgeRecent({ symbol: "NVDA", items: [advice], now: NOW }).lead).toBeUndefined();
  });

  it("is not hushed by a headline Jev has not read, which never passes itself", () => {
    const unread = headline({ title: "Unread", verdict: undefined, about: undefined, publishedAt: NOW - HOUR });
    expect(judge([headline(), unread])).toEqual(today);
    expect(judge([unread])).toEqual(silent);
  });
});

describe("windowStart", () => {
  it("opens at New York midnight six calendar days back", () => {
    expect(windowStart(NOW)).toBe(Date.UTC(2026, 8, 25, 4));
    // The whole New York day shares one start.
    expect(windowStart(Date.UTC(2026, 9, 1, 4, 1))).toBe(windowStart(Date.UTC(2026, 9, 2, 3, 59)));
  });

  it("counts calendar days, not 24 hour blocks, across both daylight saving changes", () => {
    // Fall back on Sunday 1 November 2026: the 25 hour day. Late that evening (23:30 EST) the window
    // still opens at midnight EDT on Monday 26 October, not an hour later.
    expect(windowStart(Date.UTC(2026, 10, 2, 4, 30))).toBe(Date.UTC(2026, 9, 26, 4));
    // The next day, noon EST: midnight EDT on 27 October.
    expect(windowStart(Date.UTC(2026, 10, 2, 17))).toBe(Date.UTC(2026, 9, 27, 4));
    // Spring forward on Sunday 8 March 2026: noon EDT on the 10th opens at midnight EST on the 4th (05:00 UTC).
    expect(windowStart(Date.UTC(2026, 2, 10, 16))).toBe(Date.UTC(2026, 2, 4, 5));
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

  it("hides an older answer's looked without inNews: it would now say nothing", () => {
    expect(lookStateFor({ symbol: "NVDA", data: data({ NVDA: { looked: true, inNews: false } }), loading: false, now: NOW }).kind).toBe("hidden");
  });

  it("shows the week's news, which an older page's fields leave silent", () => {
    const week = { looked: false, inNews: false, inNewsWeek: true, story: story() };
    expect(lookStateFor({ symbol: "NVDA", data: data({ NVDA: week }), loading: false, now: NOW })).toEqual({ kind: "shown", look: week });
  });

  it("drops a news claim that carries no headline: nothing is said the drawer cannot show", () => {
    const bare = { looked: true, inNews: true, inNewsWeek: true };
    expect(lookStateFor({ symbol: "NVDA", data: data({ NVDA: bare }), loading: false, now: NOW }).kind).toBe("hidden");
    // A large move still stands on its own, without the news line.
    expect(lookStateFor({ symbol: "NVDA", data: data({ NVDA: { ...bare, movePct: 4 } }), loading: false, now: NOW })).toEqual({
      kind: "shown",
      look: { looked: false, inNews: false, inNewsWeek: false, movePct: 4 },
    });
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

describe("firstBuyProposals", () => {
  const data = (looks: FirstLookResponse["looks"], over: Partial<FirstLookResponse> = {}): FirstLookResponse => ({
    judged: true,
    asOf: NOW - HOUR,
    looks,
    ...over,
  });
  const week = (symbol: string) => ({ looked: false, inNews: false, inNewsWeek: true, story: story(symbol) });
  const silent = { looked: false, inNews: false, inNewsWeek: false };

  it("offers only the names with a headline this week, in their usual order, each with news to show", () => {
    const answer = data({ SPY: silent, NVDA: week("NVDA"), AAPL: { ...silent, movePct: 3 }, TSLA: week("TSLA") });
    const proposals = firstBuyProposals({ data: answer, loading: false, now: NOW });
    expect(proposals).toEqual({ kind: "news", symbols: ["NVDA", "TSLA"] });
    // The invariant: every name offered under news has a headline the drawer shows, for that name.
    for (const symbol of proposals.kind === "news" ? proposals.symbols : []) {
      const state = lookStateFor({ symbol, data: answer, loading: false, now: NOW });
      expect(state.kind).toBe("shown");
      expect(state.kind === "shown" && newsOf(state.look)?.symbol).toBe(symbol);
    }
  });

  it("never offers a name for news it claims without a headline", () => {
    const answer = data({ SPY: { looked: true, inNews: true, inNewsWeek: true }, NVDA: week("NVDA") });
    expect(firstBuyProposals({ data: answer, loading: false, now: NOW })).toEqual({ kind: "news", symbols: ["NVDA"] });
  });

  it("offers all four with no news when none has a headline, the look failed, is stale or is off", () => {
    const plain = { kind: "plain", symbols: [...FIRST_LOOK_SYMBOLS] };
    expect(firstBuyProposals({ data: data({ SPY: silent, NVDA: { looked: true, inNews: true } }), loading: false, now: NOW })).toEqual(plain);
    expect(firstBuyProposals({ data: undefined, loading: false, now: NOW })).toEqual(plain);
    expect(firstBuyProposals({ data: data({ NVDA: week("NVDA") }, { judged: false }), loading: false, now: NOW })).toEqual(plain);
    expect(firstBuyProposals({ data: data({ NVDA: week("NVDA") }, { asOf: Date.UTC(2026, 9, 1, 3) }), loading: false, now: NOW })).toEqual(plain);
    for (const symbol of FIRST_LOOK_SYMBOLS) {
      const state = lookStateFor({ symbol, data: data({ SPY: silent, NVDA: { looked: true, inNews: true } }), loading: false, now: NOW });
      expect(state.kind === "shown" && newsOf(state.look)).toBeFalsy();
    }
  });

  it("holds the place while the look is on its way", () => {
    expect(firstBuyProposals({ data: undefined, loading: true, now: NOW })).toEqual({ kind: "loading" });
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
describe("the onboarding red team's rule", () => {
  // Every line that can stand beside the examples or their Buy.
  const words = COPY.firstLook;
  const lines = [
    words.rowInNews,
    words.rowInNewsWeek,
    words.inNews("NVIDIA"),
    words.inNewsWeek("NVIDIA"),
    words.moreNews("NVIDIA"),
    words.opensPanel,
    words.newsNote,
    COPY.calmHome.pickLabel,
    COPY.calmHome.firstTitle,
    COPY.calmHome.firstChoose,
  ];

  it("never says why a name is there, nor ranks it: no trending, hot, popular, top or most", () => {
    for (const line of lines) expect(line).not.toMatch(/\b(trend\w*|hot|popular|buzz\w*|top|most|hottest|recommend\w*|pick(ed)? for you)\b/i);
  });

  it("never claims today of the week's news, and never uses a dash as punctuation", () => {
    for (const line of [words.rowInNewsWeek, words.inNewsWeek("NVIDIA")]) expect(line).not.toMatch(/today/i);
    for (const line of lines) expect(line).not.toMatch(/ [-\u2013\u2014] /);
  });
});
