import { describe, expect, it } from "vitest";
import { looksLikeTickerList } from "@/lib/news";
import {
  canonicalUrl,
  chooseLead,
  jaccard,
  leadRank,
  matchStory,
  normaliseTitle,
  titleTokens,
  worthIngesting,
  type FoldTarget,
} from "@/lib/news-fold";

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 2, 16);

function target(storyId: number, title: string, extra: Partial<FoldTarget> = {}): FoldTarget {
  return {
    storyId,
    urls: [],
    titleKeys: [normaliseTitle(title)],
    titles: [title],
    symbols: ["NVDA"],
    publishedAt: NOW - HOUR,
    ...extra,
  };
}

describe("normaliseTitle", () => {
  it("gives two copies of one headline the same key, a syndication suffix and all", () => {
    expect(normaliseTitle("Nvidia's Huang Says Demand Is 'Insane' - Reuters")).toBe(normaliseTitle("Nvidias Huang says demand is insane"));
    expect(normaliseTitle("Apple Opens Store | CNBC")).toBe("apple opens store");
  });

  it("keeps a dash that is part of the headline rather than a publisher", () => {
    expect(normaliseTitle("Micron Q4 - Beats Estimates")).toBe("micron q4 beats estimates");
  });
});

describe("canonicalUrl", () => {
  it("drops www, the fragment, a trailing slash and tracking parameters", () => {
    expect(canonicalUrl("https://www.reuters.com/markets/nvidia-123/?utm_source=x&mod=rss#top")).toBe("reuters.com/markets/nvidia-123");
  });

  it("keeps parameters that choose the page", () => {
    expect(canonicalUrl("https://example.com/a?id=7&utm_medium=feed")).toBe("example.com/a?id=7");
  });

  it("refuses what is not a web address", () => {
    expect(canonicalUrl("mailto:someone@example.com")).toBeUndefined();
    expect(canonicalUrl("not a url")).toBeUndefined();
  });
});

describe("jaccard", () => {
  it("is shared words over all words, ignoring filler", () => {
    expect(jaccard(titleTokens("Tesla secures $30 billion credit"), titleTokens("Tesla secures 30 billion in credit"))).toBe(1);
    expect(jaccard(new Set(), new Set(["a"]))).toBe(0);
  });
});

describe("matchStory", () => {
  it("folds by canonical url first, whatever the words", () => {
    const hit = matchStory(
      { title: "Something else entirely", url: "https://www.example.com/x/?utm_source=a", symbols: ["AMD"], publishedAt: NOW },
      [target(4, "Nvidia rises", { urls: ["example.com/x"] })],
    );
    expect(hit).toEqual({ kind: "same", storyId: 4, by: "url" });
  });

  it("folds the same title from another source on the same listing", () => {
    const hit = matchStory(
      { title: "Nvidia Rises On Data Centre Deal - Reuters", url: "https://b.example/2", symbols: ["NVDA", "AMD"], publishedAt: NOW },
      [target(5, "Nvidia rises on data centre deal")],
    );
    expect(hit).toEqual({ kind: "same", storyId: 5, by: "title" });
  });

  it("folds close wording on a shared listing inside two days, and not outside", () => {
    const item = { title: "Nvidia agrees to supply chips for new Texas data centre", url: "https://c.example/3", symbols: ["NVDA"], publishedAt: NOW };
    const near = target(6, "Nvidia agrees to supply chips for new data centre in Texas");
    expect(matchStory(item, [near])).toEqual({ kind: "same", storyId: 6, by: "words" });
    expect(matchStory(item, [{ ...near, publishedAt: NOW - 49 * HOUR }])).toEqual({ kind: "new" });
    expect(matchStory(item, [{ ...near, symbols: ["AMD"] }])).toEqual({ kind: "new" });
  });

  it("hands a near miss to Jev rather than folding it", () => {
    const hit = matchStory(
      { title: "Nvidia will supply chips to OpenAI data centre site", url: "https://d.example/4", symbols: ["NVDA"], publishedAt: NOW },
      [target(7, "Nvidia agrees to supply chips for new data centre in Texas")],
    );
    expect(hit).toEqual({ kind: "near", storyIds: [7] });
  });

  it("lets a post fold into a headline on a lower floor", () => {
    const title = "Tesla delivered a record 497,099 vehicles in the quarter";
    const post = { title: "Tesla delivered a record 497,099 vehicles in the third quarter, beating estimates", url: "https://x.com/a/status/1", symbols: ["NVDA"], publishedAt: NOW };
    expect(matchStory(post, [target(8, title)]).kind).toBe("near");
    expect(matchStory({ ...post, isPost: true }, [target(8, title)])).toEqual({ kind: "same", storyId: 8, by: "words" });
  });
});

describe("chooseLead", () => {
  it("leads with the company or the SEC, then a wire, then the press, then aggregators", () => {
    const items = [
      { publisher: "The Motley Fool", publishedAt: 1 },
      { publisher: "CNBC", publishedAt: 3 },
      { publisher: "Reuters", publishedAt: 4 },
      { publisher: "NVIDIA", publishedAt: 5, primary: true },
    ];
    expect(chooseLead(items)?.publisher).toBe("NVIDIA");
    expect(chooseLead(items.slice(0, 3))?.publisher).toBe("Reuters");
    expect(chooseLead(items.slice(0, 2))?.publisher).toBe("CNBC");
    expect(leadRank({ publisher: "Zacks", publishedAt: 0 })).toBeGreaterThan(leadRank({ publisher: "Some Blog", publishedAt: 0 }));
  });

  it("takes the first among equals", () => {
    expect(chooseLead([{ publisher: "Zacks", publishedAt: 9 }, { publisher: "Benzinga", publishedAt: 2 }])?.publisher).toBe("Benzinga");
  });
});

describe("worthIngesting", () => {
  const ok = (title: string, publishedAt = NOW - HOUR) => worthIngesting({ title, publishedAt }, NOW, 14 * 24 * HOUR, looksLikeTickerList);
  it("keeps a dated sentence and drops lists, the stale and the future", () => {
    expect(ok("Apple opens its largest store in India")).toBe(true);
    expect(ok("Pre-Market Most Active : NIO, RZLV, TQQQ, SQQQ, WFC")).toBe(false);
    expect(ok("Apple opens a store", NOW - 15 * 24 * HOUR)).toBe(false);
    expect(ok("Apple opens a store", NOW + 2 * HOUR)).toBe(false);
  });
});

describe("matchStory refuses two stories that only read alike (review, 2026-10-02)", () => {
  const item = (title: string, extra: Partial<{ symbols: string[]; publishedAt: number; url: string }> = {}) => ({
    title,
    url: extra.url ?? `https://e.example/${encodeURIComponent(title)}`,
    symbols: extra.symbols ?? ["NVDA"],
    publishedAt: extra.publishedAt ?? NOW,
  });

  it("a desk's daily template, a day apart or pointing the other way", () => {
    const monday = target(1, "Nvidia (NVDA) Stock Sinks As Market Gains: What You Should Know", { publishedAt: NOW - 24 * HOUR });
    expect(matchStory(item("Nvidia (NVDA) Stock Sinks As Market Gains: What You Should Know"), [monday])).toEqual({ kind: "new" });
    const today = target(2, "Nvidia (NVDA) Stock Sinks As Market Gains: What You Should Know", { publishedAt: NOW - HOUR });
    expect(matchStory(item("Nvidia (NVDA) Stock Rises As Market Gains: What You Should Know"), [today]).kind).not.toBe("same");
  });

  it("figures that differ", () => {
    expect(matchStory(item("Apple Raises Dividend by 4%", { symbols: ["AAPL"] }), [target(3, "Apple Raises Dividend by 5%", { symbols: ["AAPL"] })])).toEqual({ kind: "new" });
    expect(matchStory(item("Strategy Raises $1 Billion in Notes", { symbols: ["AAPL"] }), [target(4, "Strategy Raises $2 Billion in Notes", { symbols: ["AAPL"] })])).toEqual({ kind: "new" });
    expect(matchStory(item("Micron Q2 Earnings Beat Estimates on AI Demand"), [target(5, "Micron Q3 Earnings Beat Estimates on AI Demand")])).toEqual({ kind: "new" });
    expect(titleTokens("Apple Raises Dividend by 4%").has("4")).toBe(true);
  });

  it("an identical title on another listing, or days later, is not the same story", () => {
    expect(matchStory(item("Stocks to Watch This Week", { symbols: ["AAPL"] }), [target(6, "Stocks to Watch This Week")])).toEqual({ kind: "new" });
    expect(matchStory(item("Stocks to Watch This Week"), [target(7, "Stocks to Watch This Week", { publishedAt: NOW - 6 * 24 * HOUR })])).toEqual({ kind: "new" });
  });

  it("while the same url is one story whatever else differs", () => {
    expect(matchStory(item("Anything", { symbols: ["AMD"], url: "https://e.example/a" }), [target(8, "Other", { urls: ["e.example/a"], publishedAt: NOW - 6 * 24 * HOUR })]).kind).toBe("same");
  });
});

describe("canonicalUrl for X", () => {
  it("makes twitter.com and x.com one address and drops the share parameters", () => {
    expect(canonicalUrl("https://twitter.com/Tesla/status/1?s=20&t=abc")).toBe("x.com/Tesla/status/1");
    expect(canonicalUrl("https://mobile.twitter.com/Tesla/status/1")).toBe("x.com/Tesla/status/1");
    expect(canonicalUrl("https://example.com/a?s=2")).toBe("example.com/a?s=2");
  });
});

describe("feed links", () => {
  it("keeps only web addresses", async () => {
    const { parseFeedItems } = await import("@/lib/news");
    const item = (link: string) => `<item><title>A</title><link>${link}</link><pubDate>Thu, 01 Oct 2026 12:00:00 GMT</pubDate></item>`;
    expect(parseFeedItems(`<rss>${item("https://a.example/1")}${item("httpx://a.example/2")}${item("javascript:alert(1)")}${item("HTTP://a.example/3")}</rss>`).map((one) => one.url)).toEqual([
      "https://a.example/1",
      "HTTP://a.example/3",
    ]);
  });
});
