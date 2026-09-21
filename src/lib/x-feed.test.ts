import { describe, expect, it } from "vitest";
import {
  MAX_QUERY_CHARS,
  avatarAt,
  buildCompanyQuery,
  buildPressQueries,
  looksEmpty,
  looksPromotional,
  engagementScore,
  rankPosts,
  symbolsForText,
  type XPost,
} from "./x-feed";

/**
 * The query budget, pinned. X rejects a recent-search query over 512
 * characters with a 400 (measured, not assumed: a combined company-and-press
 * query came to 769 and was refused), and every query is an API call we pay
 * for, so the shape of these strings is the whole cost model. If a new
 * account or topic pushes the packer to an extra query, that is a third of
 * the budget again and this test should be the one to say so.
 */
describe("query building", () => {
  it("asks for the companies in one request", () => {
    const query = buildCompanyQuery();
    expect(query.length).toBeLessThanOrEqual(MAX_QUERY_CHARS);
    expect(query).toContain("from:nvidia");
    expect(query).toContain("-is:retweet");
  });

  it("asks for the whole press tier in one request", () => {
    const queries = buildPressQueries();
    expect(queries).toHaveLength(1);
    for (const query of queries) {
      expect(query.length).toBeLessThanOrEqual(MAX_QUERY_CHARS);
    }
  });

  it("quotes a phrase and leaves a bare word alone", () => {
    const [press] = buildPressQueries();
    expect(press).toContain('"S&P 500"');
    expect(press).toContain("(NVIDIA OR Apple");
    // The coarse net carries names, not cashtags: a wire writes "NVIDIA",
    // and the cashtag is for the local match, where it costs nothing.
    expect(press).not.toContain("$NVDA");
  });

  it("leaves room to spare, so one added name is not one added call", () => {
    const [press] = buildPressQueries();
    expect(press.length).toBeLessThan(MAX_QUERY_CHARS - 80);
  });

  it("is two calls in total, which is the floor the length limit allows", () => {
    expect(1 + buildPressQueries().length).toBe(2);
  });

  it("splits rather than overrun when there is more to ask", () => {
    const many = Array.from({ length: 40 }, (_, index) => ({
      symbol: `S${index}`,
      terms: [`termnumber${index}`, `$SYM${index}`],
    }));
    const queries = buildPressQueries(many);
    expect(queries.length).toBeGreaterThan(1);
    for (const query of queries) {
      expect(query.length).toBeLessThanOrEqual(MAX_QUERY_CHARS);
    }
  });
});

describe("symbolsForText", () => {
  it("places a wire story against the listing it names", () => {
    expect(symbolsForText("Oil falls amid Mideast diplomacy hopes")).toContain(
      "USO",
    );
    expect(symbolsForText("NVIDIA beats on datacentre revenue")).toContain(
      "NVDA",
    );
  });

  it("reads a cashtag as the name it is", () => {
    expect(symbolsForText("US futures gain $SPY $QQQ")).toEqual(
      expect.arrayContaining(["SPY", "QQQ"]),
    );
  });

  it("does not mistake the Treasury Secretary for a Treasury fund", () => {
    // Live sample, and the reason `not` exists at all.
    const post = "Treasury Secretary Bessent talks to CNBC on affordability";
    expect(symbolsForText(post)).not.toContain("SGOV");
  });

  it("keeps a word boundary, so silver is not Silverman", () => {
    expect(symbolsForText("A profile of Ben Silverman")).not.toContain("SLV");
    expect(symbolsForText("Silver hits a new high")).toContain("SLV");
  });

  it("says nothing about a post that is about nothing we list", () => {
    expect(symbolsForText("The weather in London is poor again")).toEqual([]);
  });
});

describe("what never reaches a card", () => {
  it("drops the schedule notes a wire runs between stories", () => {
    expect(
      looksPromotional('COMING UP: Treasury Secretary joins "Squawk Box."'),
    ).toBe(true);
    expect(looksPromotional("Tune in to CNBC at 8 a.m. ET")).toBe(true);
    expect(looksPromotional("Subscribe to our free daily newsletter")).toBe(true);
  });

  it("leaves real reporting alone", () => {
    expect(
      looksPromotional("Strategy has acquired 950 BTC and repurchased $174M"),
    ).toBe(false);
  });

  it("drops a post that is only a link, which renders as an empty card", () => {
    expect(looksEmpty("https://t.co/abc123")).toBe(true);
    expect(looksEmpty("$NVDA $AAPL https://t.co/abc123")).toBe(true);
    expect(looksEmpty("Oil falls amid diplomacy hopes https://t.co/x")).toBe(
      false,
    );
  });
});

describe("avatarAt", () => {
  it("asks for the size that survives a retina screen", () => {
    expect(avatarAt("https://pbs.twimg.com/profile_images/1/a_normal.jpg")).toBe(
      "https://pbs.twimg.com/profile_images/1/a_bigger.jpg",
    );
  });

  it("leaves a url it does not recognise alone", () => {
    const url = "https://pbs.twimg.com/profile_images/1/a.png";
    expect(avatarAt(url)).toBe(url);
  });
});

describe("rankPosts", () => {
  const post = (id: string, symbol: string, likes: number): XPost => ({
    id,
    text: `post ${id}`,
    publishedAt: 1_700_000_000_000 + Number(id),
    author: { name: "A", username: "a", avatarUrl: "https://x/a.jpg" },
    url: `https://x.com/a/status/${id}`,
    likes,
    retweets: 0,
    quotes: 0,
    symbol,
    name: symbol,
  });

  it("puts what carried furthest first", () => {
    const ranked = rankPosts(
      [post("1", "NVDA", 10), post("2", "TSLA", 900), post("3", "SPY", 100)],
      { limit: 12, perSymbol: 2 },
    );
    expect(ranked.map((entry) => entry.id)).toEqual(["2", "3", "1"]);
  });

  it("weighs a repost above a like, since it costs the sender more", () => {
    const quiet = { ...post("1", "NVDA", 100), retweets: 0 };
    const carried = { ...post("2", "TSLA", 50), retweets: 40 };
    expect(engagementScore(carried)).toBeGreaterThan(engagementScore(quiet));
  });

  it("does not let the two loudest accounts take the whole column", () => {
    // The live shape: SpaceX and Saylor score twenty times a wire's best.
    const loud = Array.from({ length: 10 }, (_, index) =>
      post(`L${index}`, "SPCX", 30_000 - index),
    );
    const rest = ["NVDA", "TSLA", "SPY", "USO"].map((symbol, index) =>
      post(`R${index}`, symbol, 500),
    );
    const ranked = rankPosts([...loud, ...rest], { limit: 12, perSymbol: 2 });
    const spacex = ranked.filter((entry) => entry.symbol === "SPCX");
    expect(spacex.length).toBeLessThanOrEqual(4);
    expect(new Set(ranked.map((entry) => entry.symbol)).size).toBeGreaterThan(1);
  });

  it("drops a post it has already seen, since two queries can both find it", () => {
    const ranked = rankPosts([post("1", "NVDA", 10), post("1", "NVDA", 10)], {
      limit: 12,
      perSymbol: 2,
    });
    expect(ranked).toHaveLength(1);
  });
});
