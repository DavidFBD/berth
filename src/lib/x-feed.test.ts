import { describe, expect, it } from "vitest";
import {
  MAX_QUERY_CHARS,
  avatarAt,
  buildCompanyQuery,
  buildPressQueries,
  PRESS_SOURCES,
  looksEmpty,
  looksPromotional,
  FRESH_WINDOW_MS,
  HALF_LIFE_MS,
  MAX_AGE_MS,
  STRONG_STANDING,
  newestFirst,
  standingOf,
  stillCurrent,
  authorBaselines,
  engagementScore,
  formatCount,
  newsScore,
  rankPosts,
  recencyWeight,
  stripLinks,
  substanceWeight,
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

  it("asks for the whole press tier in two requests", () => {
    // Twenty-seven accounts since 2026-09-30: their from: list alone is
    // about the 512-character limit, so it splits into groups, each asking
    // every topic. Two is what that costs; more means the list grew.
    const queries = buildPressQueries();
    expect(queries).toHaveLength(2);
    for (const query of queries) {
      expect(query.length).toBeLessThanOrEqual(MAX_QUERY_CHARS);
    }
  });

  it("keeps every press account and every topic in play", () => {
    const joined = buildPressQueries().join(" ");
    for (const name of PRESS_SOURCES) expect(joined).toContain(`from:${name}`);
    for (const query of buildPressQueries()) expect(query).toContain("NVIDIA");
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
    for (const query of buildPressQueries()) expect(query.length).toBeLessThan(MAX_QUERY_CHARS - 50);
    expect(press.length).toBeLessThan(MAX_QUERY_CHARS - 50);
  });

  it("is three queries in total, the company tier and two press groups", () => {
    // Each runs at ten posts whenever lib/x-schedule gives it a turn.
    expect(1 + buildPressQueries().length).toBe(3);
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

const RANK_NOW = 1_700_000_000_000;

describe("rankPosts", () => {
  const post = (id: string, symbol: string, likes: number): XPost => ({
    id,
    text: `post ${id}`,
    publishedAt: RANK_NOW - 60_000,
    author: { name: "A", username: "a", avatarUrl: "https://x/a.jpg" },
    url: `https://x.com/a/status/${id}`,
    likes,
    retweets: 0,
    quotes: 0,
    replies: 0,
    symbol,
    name: symbol,
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
    const ranked = rankPosts([...loud, ...rest], { limit: 12, perSymbol: 2, now: RANK_NOW });
    const spacex = ranked.filter((entry) => entry.symbol === "SPCX");
    expect(spacex.length).toBeLessThanOrEqual(4);
    expect(new Set(ranked.map((entry) => entry.symbol)).size).toBeGreaterThan(1);
  });

  it("drops a post it has already seen, since two queries can both find it", () => {
    const ranked = rankPosts([post("1", "NVDA", 10), post("1", "NVDA", 10)], {
      limit: 12,
      perSymbol: 2,
      now: RANK_NOW,
    });
    expect(ranked).toHaveLength(1);
  });
});

/**
 * The column's editorial rule, pinned against the posts that exposed it.
 *
 * Ranking by raw engagement ranked fame: in the first live run @saylor's "The
 * only clarity you need is Bitcoin" (27,661 likes) and SpaceX's rocket
 * marketing took four of the top four, and Walter Bloomberg's "US 10-year
 * yield hits highest since 2007" placed tenth. Every case below is from that
 * run.
 */
describe("news scoring", () => {
  const NOW = Date.UTC(2026, 8, 21, 12, 0, 0);
  const daysAgo = (days: number) => NOW - days * 24 * 60 * 60 * 1000;

  const make = (
    over: Partial<XPost> & { username: string; likes: number },
  ): XPost => ({
    id: `${over.username}-${over.likes}-${over.publishedAt ?? 0}`,
    text: "a post about something or other that is reasonably long",
    publishedAt: NOW,
    author: {
      name: over.username,
      username: over.username,
      avatarUrl: "https://x/a.jpg",
    },
    url: "https://x.com/a/status/1",
    retweets: 0,
    quotes: 0,
    replies: 0,
    symbol: "NVDA",
    name: "NVIDIA",
    ...over,
  });

  it("measures a post against its own author, not against everyone", () => {
    // A wire at three times its normal reach is a scoop; a huge account
    // posting below its own average is having a slow day.
    const sample = [
      ...[300, 320, 280].map((likes) => make({ username: "wire", likes })),
      ...[20_000, 25_000, 30_000].map((likes) =>
        make({ username: "famous", likes }),
      ),
    ];
    const baselines = authorBaselines(sample);
    expect(baselines.get("wire")).toBe(300);
    expect(baselines.get("famous")).toBe(25_000);

    const scoop = make({ username: "wire", likes: 900 });
    const slowDay = make({ username: "famous", likes: 20_000 });
    expect(newsScore(scoop, baselines, NOW)).toBeGreaterThan(
      newsScore(slowDay, baselines, NOW),
    );
  });

  it("gives a sparse author no baseline, so one post is not a median", () => {
    const sample = [make({ username: "issuer", likes: 40 })];
    expect(authorBaselines(sample).has("issuer")).toBe(false);
  });

  it("halves a post's standing every half day", () => {
    expect(HALF_LIFE_MS).toBe(12 * 60 * 60 * 1000);
    expect(recencyWeight(NOW, NOW)).toBeCloseTo(1);
    expect(recencyWeight(NOW - HALF_LIFE_MS, NOW)).toBeCloseTo(0.5);
    expect(recencyWeight(daysAgo(1), NOW)).toBeCloseTo(0.25);
  });

  it("puts this morning's post clearly above yesterday's of equal weight", () => {
    // Same author, same reach, same substance: only the age differs, and a
    // day of it is now a factor of four rather than a rounding error.
    const sample = [300, 320, 280].map((likes) =>
      make({ username: "wire", likes }),
    );
    const text = "Treasury yields rise 12 basis points after the jobs report";
    const yesterday = make({ username: "wire", likes: 600, publishedAt: daysAgo(1), text });
    const today = make({ username: "wire", likes: 600, publishedAt: NOW, text });
    const baselines = authorBaselines([...sample, yesterday, today]);
    expect(newsScore(today, baselines, NOW)).toBeCloseTo(
      4 * newsScore(yesterday, baselines, NOW),
    );
  });

  it("prefers a post carrying a figure to a slogan", () => {
    expect(
      substanceWeight("Strategy has acquired 950 BTC and repurchased $174M"),
    ).toBeGreaterThan(substanceWeight("The only clarity you need is Bitcoin."));
    expect(substanceWeight("A little more orange.")).toBeLessThan(1);
    expect(
      substanceWeight("The 10-year Treasury yield climbed above 5%"),
    ).toBeGreaterThan(1);
  });

  it("puts this morning's announcement above last week's slogan", () => {
    const sample = [
      ...[5_000, 4_000, 6_000].map((likes) =>
        make({ username: "saylor", likes, publishedAt: daysAgo(4) }),
      ),
      ...[500, 400, 600].map((likes) =>
        make({ username: "strategy", likes, publishedAt: daysAgo(4) }),
      ),
    ];
    const slogan = make({
      username: "saylor",
      likes: 27_661,
      retweets: 2_875,
      publishedAt: daysAgo(6),
      text: "The only clarity you need is Bitcoin.",
    });
    const announcement = make({
      username: "strategy",
      likes: 1_093,
      publishedAt: NOW,
      text: "Strategy has acquired 950 BTC and repurchased $174M of $STRC.",
    });
    const baselines = authorBaselines([...sample, slogan, announcement]);
    expect(newsScore(announcement, baselines, NOW)).toBeGreaterThan(
      newsScore(slogan, baselines, NOW),
    );
  });

  it("keeps a post at four times its author's normal above a normal fresh one at a day and a half", () => {
    // Pinned against the one-day half life: 4 x 2^-1.5 is about 1.41 against 1.
    const sample = [300, 300, 300, 300, 300].map((likes) =>
      make({ username: "wire", likes }),
    );
    const text = "Oil settles higher as supply talks stall, with traders watching the weekly inventory data";
    const strong = make({ username: "wire", likes: 1_200, publishedAt: NOW - 1.5 * HALF_LIFE_MS, text });
    const normal = make({ username: "wire", likes: 300, publishedAt: NOW, text });
    const baselines = authorBaselines([...sample, strong, normal]);
    expect(baselines.get("wire")).toBe(300);
    expect(newsScore(strong, baselines, NOW)).toBeGreaterThan(
      newsScore(normal, baselines, NOW),
    );
  });

  it("lets a genuinely big post beat a weak fresh one for a day, and keeps it past two", () => {
    const sample = [300, 320, 280].map((likes) =>
      make({ username: "wire", likes }),
    );
    const text = "Fed cuts rates by 50 basis points, its largest move since 2020";
    const huge = make({ username: "wire", likes: 9_000, publishedAt: daysAgo(1), text });
    const ordinary = make({
      username: "wire",
      likes: 340,
      publishedAt: NOW,
      text: "Markets open slightly higher on light volume ahead of data",
    });
    const baselines = authorBaselines([...sample, huge, ordinary]);
    expect(newsScore(huge, baselines, NOW)).toBeGreaterThan(
      newsScore(ordinary, baselines, NOW),
    );
    // Three days on it is no longer ahead of today's, but it is still shown.
    const later = NOW + 2 * 24 * 60 * 60 * 1000;
    expect(stillCurrent(huge.publishedAt, standingOf(huge, baselines), later)).toBe(true);
  });
});

describe("freshness", () => {
  const NOW = Date.UTC(2026, 8, 29, 12, 0, 0);
  const HOUR = 60 * 60 * 1000;
  const make = (id: string, hoursAgo: number, likes = 300): XPost => ({
    id,
    text: "Oil settles higher as supply talks stall, with traders watching the weekly inventory data",
    publishedAt: NOW - hoursAgo * HOUR,
    author: { name: "Wire", username: "wire", avatarUrl: "https://x/a.jpg" },
    url: `https://x.com/wire/status/${id}`,
    likes,
    retweets: 0,
    quotes: 0,
    replies: 0,
    symbol: "USO",
    name: "Oil fund",
  });

  it("keeps anything inside two days, past that only the very strong, past five nothing", () => {
    expect(stillCurrent(NOW - 47 * HOUR, 0.5, NOW)).toBe(true);
    expect(stillCurrent(NOW - FRESH_WINDOW_MS - HOUR, STRONG_STANDING - 0.01, NOW)).toBe(false);
    expect(stillCurrent(NOW - FRESH_WINDOW_MS - HOUR, STRONG_STANDING, NOW)).toBe(true);
    expect(stillCurrent(NOW - MAX_AGE_MS - HOUR, 100, NOW)).toBe(false);
  });

  it("lets this morning's posts outrank a week of the same wire's best", () => {
    // The live shape on 2026-09-29: the column's top two were 33 and 36
    // hours old, and its reserve reached back six days.
    const week = [30, 36, 60, 100, 150].map((hours, index) => make(`old${index}`, hours, 600));
    const today = [1, 3].map((hours, index) => make(`new${index}`, hours, 300));
    const ranked = rankPosts([...week, ...today], { limit: 2, perSymbol: 2, now: NOW });
    expect(ranked.map((post) => post.id)).toEqual(["new0", "new1"]);
    const all = rankPosts([...week, ...today], { limit: 12, perSymbol: 12, now: NOW });
    // Twice the wire's normal is not strong enough to outlive two days.
    expect(all.map((post) => post.id)).not.toContain("old2");
    expect(all.map((post) => post.id)).not.toContain("old4");
  });

  it("still ranks a fresh post whose author has only stale ones in hand", () => {
    const ranked = rankPosts([make("a", 100), make("b", 120), make("c", 2)], {
      limit: 12,
      perSymbol: 12,
      now: NOW,
    });
    expect(ranked.map((post) => post.id)).toEqual(["c"]);
  });

  it("puts the chosen cards newest first without changing which were chosen", () => {
    const cards = [make("mid", 5), make("new", 1), make("old", 20)];
    expect(newestFirst(cards).map((post) => post.id)).toEqual(["new", "mid", "old"]);
    expect(cards.map((post) => post.id)).toEqual(["mid", "new", "old"]);
  });
});

describe("stripLinks", () => {
  it("takes out the dead shortener a card cannot click", () => {
    expect(
      stripLinks("Oil falls amid diplomacy hopes https://t.co/jUb3cTeyu6"),
    ).toBe("Oil falls amid diplomacy hopes");
  });

  it("takes out the same link Reuters printed twice", () => {
    expect(
      stripLinks("China's Xi to visit the US https://t.co/zvogXpbNld https://t.co/zvogXpbNld"),
    ).toBe("China's Xi to visit the US");
  });

  it("leaves a link in the middle without gluing the words together", () => {
    expect(stripLinks("Watch https://t.co/abc the launch")).toBe(
      "Watch the launch",
    );
  });

  it("keeps the author's own line breaks", () => {
    expect(stripLinks("Flight 14 is go.\n\nTuesday. https://t.co/a")).toBe(
      "Flight 14 is go.\n\nTuesday.",
    );
  });
});

/** Two placements the live column got wrong, and must not get wrong again. */
describe("placements the first live run got wrong", () => {
  it("does not read another stock's exchange tag as the Nasdaq 100 fund", () => {
    const post = "TURB Explodes on $3.48M Energy Storage Deal [NASDAQ: $TURB]";
    expect(symbolsForText(post)).not.toContain("QQQ");
  });

  it("still reads the index itself", () => {
    expect(
      symbolsForText("SpaceX will make up 2.82% of the Nasdaq 100 on Monday"),
    ).toContain("QQQ");
    expect(symbolsForText("$QQQ opens higher")).toContain("QQQ");
  });

  it("drops an event invitation wearing a news sentence", () => {
    const post =
      "What does the next phase of AI look like from the perspective of SpaceX and BlackRock?\n\nJoin Tony Kim, BlackRock's Head of Global Technology Funds, and SpaceX CFO, Bret Johnsen, for a live conversation hosted by @Fidelity Investments.";
    expect(looksPromotional(post)).toBe(true);
  });

  it("leaves a story that merely contains the word join alone", () => {
    expect(
      looksPromotional("Altman and Huang set to join Xi at White House dinner"),
    ).toBe(false);
  });
});

describe("formatCount", () => {
  it("keeps a small number exact, since rounding it reads as evasion", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(11)).toBe("11");
    expect(formatCount(264)).toBe("264");
    expect(formatCount(999)).toBe("999");
  });

  it("shortens a big one the way a reader would say it", () => {
    expect(formatCount(1_206)).toBe("1.2K");
    expect(formatCount(27_661)).toBe("27.7K");
    expect(formatCount(1_400_000)).toBe("1.4M");
  });

  it("drops a decimal that says nothing", () => {
    expect(formatCount(5_000)).toBe("5K");
    expect(formatCount(2_000_000)).toBe("2M");
  });
});
