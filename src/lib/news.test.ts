import { describe, expect, it } from "vitest";
import {
  formatTimeAgo,
  looksLikeTickerList,
  mergeNews,
  parseFeedItems,
  type NewsItem,
} from "./news";

/** A Nasdaq item, trimmed from the real feed on 2026-09-17. */
const NASDAQ = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel><title>NVDA Feed</title>
 <item>
  <title>Semiconductor Sell-Off: 1 AI Chip Stock to Buy &amp; 1 to Hold</title>
  <link>https://www.nasdaq.com/articles/semiconductor-sell-1-ai-chip-stock</link>
  <description>
        Key PointsEven after its gains, Nvidia looks undervalued.
    </description>
  <pubDate>Thu, 17 Sep 2026 10:36:00 +0000</pubDate>
  <dc:creator>The Motley Fool</dc:creator>
  <nasdaq:tickers>NVDA,AMD</nasdaq:tickers>
 </item>
</channel></rss>`;

/** An Atom entry, the shape an issuer newsroom serves. */
const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom">
 <entry>
  <title><![CDATA[NVIDIA Vera Rubin NVL72 Delivers Leading Performance]]></title>
  <link rel="alternate" href="https://blogs.nvidia.com/blog/vera-rubin-mlperf/"/>
  <updated>2026-09-16T14:00:00Z</updated>
  <author><name>NVIDIA</name></author>
 </entry>
</feed>`;

describe("parseFeedItems", () => {
  it("reads an RSS item, decoding entities and keeping the real publisher", () => {
    expect(parseFeedItems(NASDAQ)).toEqual([
      {
        title: "Semiconductor Sell-Off: 1 AI Chip Stock to Buy & 1 to Hold",
        url: "https://www.nasdaq.com/articles/semiconductor-sell-1-ai-chip-stock",
        publishedAt: Date.parse("Thu, 17 Sep 2026 10:36:00 +0000"),
        source: "The Motley Fool",
      },
    ]);
  });

  it("reads an Atom entry, whose link is an attribute and title a CDATA block", () => {
    expect(parseFeedItems(ATOM)).toEqual([
      {
        title: "NVIDIA Vera Rubin NVL72 Delivers Leading Performance",
        url: "https://blogs.nvidia.com/blog/vera-rubin-mlperf/",
        publishedAt: Date.parse("2026-09-16T14:00:00Z"),
        source: "NVIDIA",
      },
    ]);
  });

  it("drops an item that cannot be shown or placed in time", () => {
    const xml = `<rss><channel>
      <item><title>No link</title><pubDate>Thu, 17 Sep 2026 10:36:00 +0000</pubDate></item>
      <item><link>https://example.com/a</link><pubDate>Thu, 17 Sep 2026 10:36:00 +0000</pubDate></item>
      <item><title>No date</title><link>https://example.com/b</link></item>
      <item><title>Not a url</title><link>javascript:alert(1)</link><pubDate>Thu, 17 Sep 2026 10:36:00 +0000</pubDate></item>
    </channel></rss>`;
    expect(parseFeedItems(xml)).toEqual([]);
  });

  it("returns nothing for a document that is not a feed", () => {
    expect(parseFeedItems("<html><body>403 Forbidden</body></html>")).toEqual([]);
    expect(parseFeedItems("")).toEqual([]);
  });
});

describe("looksLikeTickerList", () => {
  it("rejects the most-active roundups Nasdaq mixes in", () => {
    expect(
      looksLikeTickerList(
        "Pre-Market Most Active for Sep 1, 2026 : NIO, RZLV, TQQQ, SQQQ, WFC, NVDA, NOK, IBIT",
      ),
    ).toBe(true);
    expect(
      looksLikeTickerList("After Hours Most Active for Aug 12, 2026 : LYG, F, HDB, SNAP, SGOV, AZUL"),
    ).toBe(true);
  });

  it("keeps a real headline that happens to shout a word or two", () => {
    expect(
      looksLikeTickerList("Semiconductor Sell-Off: 1 AI Chip Stock to Buy, 1 to Hold"),
    ).toBe(false);
    expect(
      looksLikeTickerList("NVDA Stock Rises as CEO Talks Up AI Demand"),
    ).toBe(false);
    expect(
      looksLikeTickerList("Snap Lands Nvidia, Amazon and Salesforce Deals"),
    ).toBe(false);
  });
});

describe("mergeNews", () => {
  const item = (title: string, publishedAt: number, source = "a"): NewsItem => ({
    title,
    url: `https://example.com/${encodeURIComponent(title)}`,
    publishedAt,
    source,
    symbol: "NVDA",
    name: "NVIDIA",
  });

  it("puts the newest first and honours the limit", () => {
    const merged = mergeNews(
      [item("older", 100), item("newest", 300), item("middle", 200)],
      { limit: 2, perSymbol: 9 },
    );
    expect(merged.map((entry) => entry.title)).toEqual(["newest", "middle"]);
  });

  it("keeps room for a quieter listing before a third story about one name", () => {
    const loud = (title: string, at: number) => ({ ...item(title, at), symbol: "NVDA" });
    const quiet = { ...item("index fund drifts", 10), symbol: "SPY", name: "S&P 500 ETF" };
    const merged = mergeNews(
      [loud("a", 400), loud("b", 300), loud("c", 200), quiet],
      { limit: 3, perSymbol: 2 },
    );
    expect(merged.map((entry) => entry.symbol)).toEqual(["NVDA", "NVDA", "SPY"]);
  });

  it("fills the remaining room on a quiet day rather than leaving it empty", () => {
    const loud = (title: string, at: number) => ({ ...item(title, at), symbol: "NVDA" });
    const merged = mergeNews([loud("a", 400), loud("b", 300), loud("c", 200)], {
      limit: 3,
      perSymbol: 2,
    });
    expect(merged.map((entry) => entry.title)).toEqual(["a", "b", "c"]);
  });

  it("keeps one card per story, whichever source reached it first", () => {
    const merged = mergeNews(
      [
        item("Nvidia beats, again", 100, "trusted"),
        item("NVIDIA BEATS AGAIN!", 900, "syndicated"),
      ],
      { limit: 10, perSymbol: 9 },
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe("trusted");
  });

  it("has nothing to show for nothing", () => {
    expect(mergeNews([], { limit: 10, perSymbol: 2 })).toEqual([]);
  });
});

describe("formatTimeAgo", () => {
  const now = Date.parse("2026-09-17T12:00:00Z");
  const ago = (ms: number) => formatTimeAgo(now - ms, now);

  it("speaks in plain words", () => {
    expect(ago(30_000)).toBe("just now");
    expect(ago(20 * 60_000)).toBe("20 minutes ago");
    expect(ago(60 * 60_000)).toBe("an hour ago");
    expect(ago(5 * 60 * 60_000)).toBe("5 hours ago");
    expect(ago(24 * 60 * 60_000)).toBe("yesterday");
    expect(ago(3 * 24 * 60 * 60_000)).toBe("3 days ago");
  });

  it("gives a date once the arithmetic stops being easy", () => {
    expect(ago(13 * 24 * 60 * 60_000)).toBe("Sep 4");
  });

  it("never counts into the future when a clock disagrees", () => {
    expect(formatTimeAgo(now + 60_000, now)).toBe("just now");
  });
});
