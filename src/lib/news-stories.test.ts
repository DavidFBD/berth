import { describe, expect, it } from "vitest";
import { forListing, heldEvents, ownedState, ownedStories, riverOf, toCard, type EventCard, type StoryCard, type StoryRecord } from "@/lib/news-stories";
import { visibleSources } from "@/lib/news-schedule";

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 2, 16);
const NAMES = new Map([
  ["NVDA", "NVIDIA"],
  ["AAPL", "Apple"],
  ["TSLA", "Tesla"],
  ["MSTR", "Strategy"],
]);

function source(id: number, source: StoryRecord["sources"][number]["source"], publisher: string, extra: Partial<StoryRecord["sources"][number]> = {}) {
  return { id, source, sourceId: `${source}-${id}`, publisher, url: `https://example.com/${id}`, title: `Title ${id}`, publishedAt: NOW - HOUR, raw: null, ...extra };
}

function story(extra: Partial<StoryRecord> = {}): StoryRecord {
  return {
    id: 1,
    kind: "article",
    leadSourceId: 10,
    publishedAt: NOW - HOUR,
    hidden: false,
    sources: [source(10, "nasdaq", "Reuters")],
    verdicts: [{ symbol: "NVDA", about: 0.9, substance: 3.6, verdict: "material", kept: true }],
    unjudged: [],
    ...extra,
  };
}

const ALL = ["nasdaq", "x", "marketaux"];
const LICENSED = ["nasdaq", "x"];

describe("toCard", () => {
  it("shows the lead's verbatim title, publisher and link, and who else reported it", () => {
    const card = toCard(
      story({
        sources: [
          source(10, "nasdaq", "Reuters", { title: "Nvidia agrees chip deal" }),
          source(11, "nasdaq", "The Motley Fool"),
          source(12, "nasdaq", "Reuters"),
          source(13, "x", "Reuters Business", { raw: { author: { name: "Reuters Business", username: "ReutersBiz" } } }),
        ],
      }),
      LICENSED,
      NAMES,
    )!;
    expect(card).toMatchObject({ id: "s1", kind: "article", title: "Nvidia agrees chip deal", publisher: "Reuters", symbol: "NVDA", name: "NVIDIA", verdict: "material" });
    expect(card.alsoReportedBy).toEqual([{ publisher: "The Motley Fool", url: "https://example.com/11" }]);
    expect(card.alsoOnX).toEqual([{ name: "Reuters Business", username: "ReutersBiz", url: "https://example.com/13" }]);
  });

  it("drops a story Jev read and kept for nothing, and keeps one it has not read yet without a verdict", () => {
    expect(toCard(story({ verdicts: [{ symbol: "NVDA", about: 0.2, substance: 1, verdict: "analysis", kept: false }] }), LICENSED, NAMES)).toBeUndefined();
    const unread = toCard(story({ verdicts: [], unjudged: ["AAPL"] }), LICENSED, NAMES)!;
    expect(unread.symbol).toBe("AAPL");
    expect(unread.verdict).toBeUndefined();
  });

  it("never shows a hidden story", () => {
    expect(toCard(story({ hidden: true }), ALL, NAMES)).toBeUndefined();
  });

  it("shows a post only with its author's face and handle", () => {
    const post = story({
      kind: "post",
      sources: [source(10, "x", "Tesla", { sourceId: "1974", raw: { author: { name: "Tesla", username: "Tesla", avatarUrl: "https://pbs.twimg.com/a.jpg" }, likes: 5 } })],
      verdicts: [{ symbol: "TSLA", about: null, substance: 3.9, verdict: "material", kept: true }],
    });
    expect(toCard(post, LICENSED, NAMES)).toMatchObject({ id: "1974", kind: "post", post: { likes: 5 } });
    const faceless = { ...post, sources: [source(10, "x", "Tesla", { raw: { author: { name: "Tesla", username: "Tesla" } } })] };
    expect(toCard(faceless, LICENSED, NAMES)).toBeUndefined();
  });
});

describe("Marketaux visibility, per mode", () => {
  const onlyMarketaux = story({ sources: [source(10, "marketaux", "GuruFocus")] });
  // Marketaux never leads a shared story (lib/server/news-store relead); the lead is the licensed copy.
  const shared = story({ leadSourceId: 21, sources: [source(20, "marketaux", "GuruFocus"), source(21, "nasdaq", "Zacks")] });
  const env = (mode: string | undefined) => ({ MARKETAU_API_KEY: "k", NEWS_MARKETAUX: mode });

  it("off: a Marketaux only story reaches no one, a shared one shows through its licensed source", () => {
    for (const staff of [false, true]) {
      const visible = visibleSources({ staff }, env("off"));
      expect(toCard(onlyMarketaux, visible, NAMES)).toBeUndefined();
      const card = toCard(shared, visible, NAMES)!;
      expect(card.publisher).toBe("Zacks");
      expect(card.alsoReportedBy).toEqual([]);
    }
  });

  it("staff: shown to a staff member only", () => {
    expect(toCard(onlyMarketaux, visibleSources({ staff: true }, env("staff")), NAMES)?.publisher).toBe("GuruFocus");
    expect(toCard(onlyMarketaux, visibleSources({ staff: false }, env("staff")), NAMES)).toBeUndefined();
    expect(toCard(shared, visibleSources({ staff: false }, env("staff")), NAMES)?.alsoReportedBy).toEqual([]);
    expect(toCard(shared, visibleSources({ staff: true }, env("staff")), NAMES)?.alsoReportedBy).toEqual([{ publisher: "GuruFocus", url: "https://example.com/20" }]);
  });

  it("everyone (the default with a key): shown to all", () => {
    for (const mode of ["everyone", undefined]) {
      expect(toCard(onlyMarketaux, visibleSources({ staff: false }, env(mode)), NAMES)?.publisher).toBe("GuruFocus");
    }
  });

  it("is off without a key, whatever the flag says", () => {
    expect(visibleSources({ staff: true }, { NEWS_MARKETAUX: "everyone" })).toEqual(LICENSED);
  });
});

function card(id: number, symbol: string, verdict: StoryCard["verdict"], hoursAgo: number): StoryCard {
  return {
    id: `s${id}`,
    storyId: id,
    kind: "article",
    title: `Story ${id}`,
    url: `https://example.com/${id}`,
    publisher: "Reuters",
    publishedAt: NOW - hoursAgo * HOUR,
    symbol,
    name: NAMES.get(symbol) ?? symbol,
    symbols: [symbol],
    verdict,
    readings: verdict ? { [symbol]: { verdict } } : {},
    alsoReportedBy: [],
    alsoOnX: [],
  };
}

describe("For what you own", () => {
  it("takes held news from the last 36 hours, material first, then newest, at most five", () => {
    const cards = [
      card(1, "NVDA", "fact", 1),
      card(2, "NVDA", "material", 10),
      card(3, "AAPL", "analysis", 2),
      card(4, "TSLA", "material", 1),
      card(5, "AAPL", "fact", 40),
      card(6, "AAPL", "fact", 3),
      card(7, "NVDA", "fact", 4),
      card(8, "NVDA", "fact", 5),
      card(9, "NVDA", "fact", 6),
    ];
    expect(ownedStories(cards, ["NVDA", "AAPL"], NOW).map((one) => one.storyId)).toEqual([2, 1, 6, 7, 8]);
  });

  it("files a story about several listings under the held one, with that listing's own reading", () => {
    const both: StoryCard = {
      ...card(1, "NVDA", "material", 1),
      symbols: ["NVDA", "AAPL"],
      readings: { NVDA: { verdict: "material", about: 0.95 }, AAPL: { verdict: "fact", about: 0.7 } },
    };
    expect(ownedStories([both], ["AAPL"], NOW)[0]).toMatchObject({ symbol: "AAPL", name: "Apple", verdict: "fact", about: 0.7 });
    // Material for NVIDIA, only analysis for Apple: not news for an Apple holder.
    const analysis: StoryCard = { ...both, readings: { NVDA: { verdict: "material" }, AAPL: { verdict: "analysis" } } };
    expect(ownedStories([analysis], ["AAPL"], NOW)).toEqual([]);
  });
});

describe("the quiet day", () => {
  it("is news when there is news", () => {
    const state = ownedState({ cards: [card(1, "NVDA", "material", 1)], held: ["NVDA", "AAPL"], read: { NVDA: 3 }, now: NOW });
    expect(state.kind).toBe("stories");
  });

  it("names only the holdings Jev read about and found nothing, and keeps apart the ones it has not read", () => {
    const state = ownedState({ cards: [card(1, "NVDA", "analysis", 1), card(2, "AAPL", "fact", 50)], held: ["NVDA", "AAPL", "TSLA"], read: { NVDA: 4, AAPL: 1 }, now: NOW });
    expect(state).toEqual({ kind: "quiet", symbols: ["NVDA", "AAPL"], unread: ["TSLA"] });
  });

  it("is never a quiet day when Jev has read nothing about them", () => {
    expect(ownedState({ cards: [], held: ["NVDA"], read: { TSLA: 9 }, now: NOW })).toEqual({ kind: "unread" });
  });
});

describe("Coming up", () => {
  const filing = (symbol: string, day: string): EventCard => ({ symbol, name: NAMES.get(symbol)!, kind: "filing", day, form: "8-K", report: "report" });
  it("keeps held listings' latest filing each, at most three", () => {
    const events = [filing("MSTR", "2026-09-28"), filing("MSTR", "2026-10-01"), filing("NVDA", "2026-09-30"), filing("TSLA", "2026-09-29"), filing("AAPL", "2026-09-30")];
    expect(heldEvents(events, ["MSTR", "NVDA"], "2026-10-02").map((event) => `${event.symbol} ${event.day}`)).toEqual(["MSTR 2026-10-01", "NVDA 2026-09-30"]);
    expect(heldEvents(events, ["MSTR", "NVDA", "TSLA", "AAPL"], "2026-10-02")).toHaveLength(3);
  });
});

describe("the river", () => {
  it("leaves out what the sections above already show, one card per story", () => {
    const cards = [card(1, "NVDA", "fact", 1), card(2, "AAPL", "fact", 2), card(1, "NVDA", "fact", 1)];
    expect(riverOf(cards, { limit: 12, perSymbol: 2, exclude: [2] }).map((one) => one.storyId)).toEqual([1]);
  });
});

describe("forListing", () => {
  it("gives a listing its own reading, none when Jev has not judged it for that listing, and nothing for a listing it is not about", () => {
    const record = story({
      verdicts: [{ symbol: "NVDA", about: 0.95, substance: 3.8, verdict: "material", kept: true }],
      // Tagged to more listings than are judged at once: Apple waits.
      unjudged: ["AAPL"],
    });
    const card = toCard(record, LICENSED, NAMES)!;
    expect(card.symbols).toEqual(["NVDA", "AAPL"]);
    const apple = forListing(card, "AAPL")!;
    expect(apple).toMatchObject({ symbol: "AAPL", name: "Apple" });
    expect(apple.verdict).toBeUndefined();
    expect(apple.about).toBeUndefined();
    expect(forListing(card, "TSLA")).toBeUndefined();
  });
});
