import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setSqlClient, type SqlClient } from "@/lib/server/db";
import { makeTestDb } from "@/lib/server/pglite-test-db";
import { ingestNews, type IngestDeps } from "@/lib/server/news-ingest";
import { claimNewsSlot, newsSpent, readEvents, releaseIngestLease, takeIngestLease } from "@/lib/server/news-store";
import { loadNewsColumn } from "@/lib/server/news-read";
import { loadListingNews } from "@/lib/server/listing-news";
import { postsFromCards } from "@/lib/server/moves";
import { heldNewsFor } from "@/lib/server/nudge";
import { TOKEN_LISTINGS } from "@/lib/listings";
import type { GatheredPosts } from "@/lib/server/x-column";
import type { XPost } from "@/lib/x-feed";

/**
 * The news store against the real schema: items folded into stories across
 * feeds and sources, each story and listing judged by Jev once and reused,
 * every source's daily cap holding, a failing source costing only its own
 * items, the slot claimed once, filings stored as events, the X column's
 * posts mirrored, and the readers' outputs as they were.
 */

let sql: SqlClient;
let close: () => Promise<void>;

const HOUR = 60 * 60 * 1000;
const NOW = Date.now();
const LISTINGS = TOKEN_LISTINGS.filter((listing) => ["NVDA", "AMD", "AAPL", "MSTR"].includes(listing.symbol));

beforeAll(async () => {
  ({ sql, close } = await makeTestDb());
  setSqlClient(sql);
});

afterAll(async () => {
  setSqlClient(null);
  await close();
});

const jevCalls = vi.fn();
function jevAnswer(body: string) {
  jevCalls(body);
  const pitch = body.includes("Should You Buy");
  const loose = body.includes("among chip names");
  return Response.json({
    answers: {
      about: { type: "noul", noul: loose ? 0.2 : 0.92 },
      substance: {
        type: "score",
        // The export rules story is only analysis for AMD, a new fact for NVIDIA.
        score: pitch ? 0.8 : body.toLowerCase().includes("record") ? 3.8 : body.includes("Advanced Micro Devices") ? 2.3 : 3.0,
        probabilities: {},
        confidence: 0.8,
      },
      same: { type: "noul", noul: 0.1 },
    },
  });
}

beforeEach(async () => {
  for (const table of ["stories", "jev_answers", "news_fetch_slots", "news_budget", "listing_events"]) {
    await sql.query(`delete from ${table}`);
  }
  jevCalls.mockClear();
  vi.stubEnv("JEV_API_KEY", "test-key");
  vi.stubEnv("JEV_DISABLED", "");
  // Marketaux has its own test (news-marketaux.db.test); these runs never ask it.
  vi.stubEnv("MARKETAU_API_KEY", "");
  vi.stubEnv("NASDAQ_DAILY_CALL_CAP", "");
  vi.stubEnv("JEV_DAILY_TOKEN_CAP", "");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).startsWith("https://api.typesafe.ai")) return jevAnswer(String(init?.body ?? ""));
      throw new Error(`unexpected fetch ${String(input)}`);
    }),
  );
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

type Headline = { title: string; by: string; hoursAgo: number; link?: string };

function rss(items: Headline[]): string {
  return `<?xml version="1.0"?><rss><channel>${items
    .map(
      (item, index) =>
        `<item><title>${item.title}</title><link>${item.link ?? `https://www.nasdaq.com/articles/${encodeURIComponent(item.title)}-${index}`}</link><pubDate>${new Date(
          NOW - item.hoursAgo * HOUR,
        ).toUTCString()}</pubDate><dc:creator>${item.by}</dc:creator></item>`,
    )
    .join("")}</channel></rss>`;
}

function nasdaq(feeds: Record<string, Headline[] | "down">): typeof fetch {
  return (async (input: string | URL | Request) => {
    const symbol = String(input).match(/symbol=([A-Z]+)/)?.[1] ?? "";
    const feed = feeds[symbol];
    if (feed === "down") return new Response("down", { status: 503 });
    return new Response(rss(feed ?? []));
  }) as typeof fetch;
}

const FEEDS: Record<string, Headline[]> = {
  NVDA: [
    // Nasdaq files one article under every symbol it touches, at one address.
    { title: "Nvidia and AMD Rise on New Chip Export Rules", by: "The Motley Fool", hoursAgo: 3, link: "https://www.nasdaq.com/articles/chip-export-rules" },
    { title: "Nvidia Reports Record Data Centre Revenue", by: "Reuters", hoursAgo: 2 },
    { title: "Should You Buy Nvidia Before Earnings?", by: "Zacks", hoursAgo: 1 },
  ],
  AMD: [{ title: "Nvidia and AMD Rise on New Chip Export Rules - Reuters", by: "Reuters", hoursAgo: 2.5, link: "https://www.nasdaq.com/articles/chip-export-rules/?utm_source=rss" }],
  AAPL: [{ title: "Apple mentioned among chip names in a market wrap", by: "Barchart", hoursAgo: 4 }],
};

const deps = (extra: Partial<IngestDeps> = {}): IngestDeps => ({
  listings: LISTINGS,
  fetcher: nasdaq(FEEDS),
  edgarPhases: [],
  sleep: async () => undefined,
  ...extra,
});

async function count(table: string): Promise<number> {
  const rows = (await sql.query(`select count(*)::int as n from ${table}`)) as { n: number }[];
  return Number(rows[0].n);
}

describe("folding", () => {
  it("makes one story of the same headline from two feeds, tagged to both, led by the wire", async () => {
    await ingestNews({ phase: "evening", now: NOW, deps: deps() });
    const rows = (await sql.query(
      `select title, publisher, publisher_count, symbols from stories where title ilike 'Nvidia and AMD%'`,
    )) as { title: string; publisher: string; publisher_count: number; symbols: string[] }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ publisher: "Reuters", publisher_count: 2, symbols: ["AMD", "NVDA"] });
    expect(await count("story_sources")).toBe(5);
    expect(await count("stories")).toBe(4);
  });

  it("is idempotent: a second run adds nothing", async () => {
    await ingestNews({ phase: "slot", now: NOW, deps: deps() });
    const summary = await ingestNews({ phase: "slot", now: NOW, deps: deps() });
    expect(summary.nasdaq).toMatchObject({ added: 0, folded: 0 });
    expect(await count("stories")).toBe(4);
  });
});

describe("Jev, once per story and listing", () => {
  it("judges each new story for each of its listings, and a second run asks nothing", async () => {
    const first = await ingestNews({ phase: "slot", now: NOW, deps: deps() });
    // Four stories, one tagged to two listings: five questions.
    expect(first.judged).toMatchObject({ asked: 5, answered: 5 });
    expect(jevCalls).toHaveBeenCalledTimes(5);
    await ingestNews({ phase: "slot", now: NOW, deps: deps() });
    expect(jevCalls).toHaveBeenCalledTimes(5);
  });

  it("reuses a stored answer rather than paying again when a verdict is lost", async () => {
    await ingestNews({ phase: "slot", now: NOW, deps: deps() });
    await sql.query(`delete from story_verdicts`);
    const again = await ingestNews({ phase: "slot", now: NOW, deps: deps() });
    expect(again.judged).toMatchObject({ asked: 5, answered: 5 });
    expect(jevCalls).toHaveBeenCalledTimes(5);
    expect(await count("story_verdicts")).toBe(5);
  });

  it("keeps the column's own rule: off-topic and pitch headlines are judged and not kept", async () => {
    await ingestNews({ phase: "slot", now: NOW, deps: deps() });
    const kept = (await sql.query(
      `select s.title, v.symbol, v.kept, v.verdict from story_verdicts v join stories s on s.id = v.story_id order by s.title, v.symbol`,
    )) as { title: string; symbol: string; kept: boolean; verdict: string }[];
    expect(kept.filter((row) => !row.kept).map((row) => row.title).sort()).toEqual([
      "Apple mentioned among chip names in a market wrap",
      "Should You Buy Nvidia Before Earnings?",
    ]);
    expect(kept.find((row) => row.title.startsWith("Nvidia Reports"))?.verdict).toBe("material");
  });
});

describe("caps and failures", () => {
  it("holds Nasdaq's daily cap", async () => {
    vi.stubEnv("NASDAQ_DAILY_CALL_CAP", String(LISTINGS.length));
    await ingestNews({ phase: "slot", now: NOW, deps: deps() });
    const second = await ingestNews({ phase: "slot", now: NOW, deps: deps() });
    expect(second.nasdaq).toEqual({ skipped: `day's cap of ${LISTINGS.length} reached` });
    const day = new Date(NOW).toISOString().slice(0, 10);
    expect(await newsSpent("nasdaq", day)).toEqual({ used: LISTINGS.length, reserved: 0, requests: LISTINGS.length });
  });

  it("holds Jev's daily token cap: past it, stories wait unjudged and show without a verdict", async () => {
    vi.stubEnv("JEV_DAILY_TOKEN_CAP", "100");
    const summary = await ingestNews({ phase: "slot", now: NOW, deps: deps() });
    expect(summary.judged).toMatchObject({ answered: 0 });
    expect(jevCalls).not.toHaveBeenCalled();
    const news = await loadListingNews("NVDA");
    expect(news.items.length).toBeGreaterThan(0);
    expect(news.items.every((item) => item.verdict === undefined)).toBe(true);
    expect(news.judged).toBeUndefined();
  });

  it("lets a failing feed cost only its own items", async () => {
    const summary = await ingestNews({ phase: "slot", now: NOW, deps: deps({ fetcher: nasdaq({ ...FEEDS, NVDA: "down" }) }) });
    expect(summary.failures).toContain("nasdaq: Nasdaq answered 503");
    expect(await count("stories")).toBe(2);
  });

  it("claims an on-demand slot once", async () => {
    const options = { retryAfterMs: 5 * 60_000, staleMs: 2 * 60_000, maxAttempts: 2 };
    const claims = await Promise.all([1, 2, 3].map(() => claimNewsSlot("ingest", "2026-10-02T13:30:00.000Z", NOW, options)));
    expect(claims.filter(Boolean)).toHaveLength(1);
  });
});

describe("filings", () => {
  it("stores EDGAR's filings as events, once, and shows only the forms a holder reads", async () => {
    const day = new Date(NOW - 24 * HOUR).toISOString().slice(0, 10);
    const edgar = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://data.sec.gov/")) {
        expect(new Headers(init?.headers).get("user-agent")).toBe("Berth support@berthmarkets.com");
        return Response.json({
          filings: { recent: { accessionNumber: [`a-${url.slice(-9, -5)}`, `b-${url.slice(-9, -5)}`], filingDate: [day, day], form: ["8-K", "4"], primaryDocument: ["d.htm", "o.xml"] } },
        });
      }
      return nasdaq(FEEDS)(input, init);
    }) as typeof fetch;
    const run = () => ingestNews({ phase: "evening", now: NOW, deps: deps({ fetcher: edgar, edgarPhases: ["evening"] }) });
    const summary = await run();
    expect(summary.edgar).toEqual({ requests: 4, events: 8 });
    await run();
    expect(await count("listing_events")).toBe(8);
    const shown = await readEvents(day, day);
    expect(shown.map((event) => event.detail.form)).toEqual(["8-K", "8-K", "8-K", "8-K"]);
    const column = await loadNewsColumn();
    expect(column.events.find((event) => event.symbol === "MSTR")).toMatchObject({ name: "Strategy", report: "report", form: "8-K" });
  });
});

function post(id: string, symbol: string, text: string, hoursAgo: number, name = "Reuters"): XPost {
  return {
    id,
    text,
    publishedAt: NOW - hoursAgo * HOUR,
    author: { name, username: name.replace(/\s/g, ""), avatarUrl: "https://pbs.twimg.com/a.jpg" },
    url: `https://x.com/${name.replace(/\s/g, "")}/status/${id}`,
    likes: 3,
    retweets: 1,
    quotes: 0,
    replies: 0,
    symbol,
    name: symbol,
  };
}

describe("X, mirrored", () => {
  const gathered = (): GatheredPosts => ({
    posts: [
      { ...post("100", "MSTR", "Strategy buys another 1,000 bitcoin", 2, "Strategy"), alsoBy: [{ name: "Walter Bloomberg", username: "DeItaone", url: "https://x.com/DeItaone/status/101" }] },
    ],
    substance: new Map([["100", 0.4 + 3.6 * 0.3]]),
    failures: [],
    curation: undefined,
    updatedAt: NOW,
    dropped: [post("200", "AAPL", "Join our trading group today", 1, "Promo")],
    companyIds: new Set(["100"]),
  });

  it("keeps a kept post as a story with its verdict and copies, and a dropped one never shows", async () => {
    await ingestNews({ phase: "slot", now: NOW, deps: deps({ gather: async () => gathered() }) });
    await ingestNews({ phase: "slot", now: NOW, deps: deps({ gather: async () => gathered() }) });
    const column = await loadNewsColumn();
    const cards = [...column.stories, ...column.reserve];
    const strategy = cards.find((card) => card.symbol === "MSTR");
    expect(strategy).toMatchObject({ id: "100", kind: "post", verdict: "material", publisher: "Strategy", post: { author: { username: "Strategy" } } });
    expect(strategy?.alsoOnX).toEqual([{ name: "Walter Bloomberg", username: "DeItaone", url: "https://x.com/DeItaone/status/101" }]);
    expect(cards.some((card) => card.title.includes("trading group"))).toBe(false);
    // The moves read it as they read the X column.
    expect(postsFromCards(cards).posts.map((one) => one.id)).toEqual(["100#MSTR"]);
  });
});

describe("the readers", () => {
  it("give the headlines in the shape they always had", async () => {
    await ingestNews({ phase: "slot", now: NOW, deps: deps() });
    const news = await loadListingNews("NVDA");
    expect(news.items.map((item) => item.title)).toEqual(["Nvidia Reports Record Data Centre Revenue", "Nvidia and AMD Rise on New Chip Export Rules - Reuters"]);
    expect(Object.keys(news.items[0]).sort()).toEqual(["about", "name", "publishedAt", "source", "symbol", "title", "url", "verdict"]);
    expect(news.items[0]).toMatchObject({ source: "Reuters", symbol: "NVDA", name: "NVIDIA", verdict: "material" });
    // Three judged for NVIDIA, the pitch not kept.
    expect(news.judged).toEqual({ read: 3, kept: 2 });
  });

  it("give each listing its own reading of a story about several", async () => {
    await ingestNews({ phase: "slot", now: NOW, deps: deps() });
    const nvidia = (await loadListingNews("NVDA")).items.find((item) => item.title.includes("Export Rules"));
    const amd = (await loadListingNews("AMD")).items.find((item) => item.title.includes("Export Rules"));
    expect(nvidia).toMatchObject({ symbol: "NVDA", verdict: "fact" });
    expect(amd).toMatchObject({ symbol: "AMD", name: "Advanced Micro Devices", verdict: "analysis" });
    const column = await loadNewsColumn();
    // News for an NVIDIA owner, not for an AMD owner.
    const story = column.owned.find((card) => card.title.includes("Export Rules"))!;
    expect(story.readings).toMatchObject({ NVDA: { verdict: "fact" }, AMD: { verdict: "analysis" } });
    const facts = (held: string[]) => ({ held, funds: false, canInvite: false }) as Parameters<typeof heldNewsFor>[0];
    expect(heldNewsFor(facts(["AMD"]), column.owned)).toEqual([]);
  });

  it("count what Jev read per listing for the quiet day, and today's totals", async () => {
    await ingestNews({ phase: "slot", now: NOW, deps: deps() });
    const column = await loadNewsColumn();
    expect(column.read).toEqual({ NVDA: 3, AMD: 1, AAPL: 1 });
    // Apple was read and nothing kept: a quiet day for an Apple holder.
    expect(column.owned.some((card) => card.symbols.includes("AAPL"))).toBe(false);
    expect(column.owned.map((card) => card.title)).toContain("Nvidia Reports Record Data Centre Revenue");
    // Five verdicts over four stories; all from the last hours, so all today unless run just after midnight New York.
    expect(column.judged?.read).toBeLessThanOrEqual(4);
  });

  it("give the nudge only news worth a line to an owner", async () => {
    await ingestNews({ phase: "slot", now: NOW, deps: deps() });
    const column = await loadNewsColumn();
    const facts = { held: ["NVDA", "AAPL"], funds: false, canInvite: false } as Parameters<typeof heldNewsFor>[0];
    // Material, and a new fact two publishers carried; never the pitch or the off-topic one.
    expect(heldNewsFor(facts, [...column.stories, ...column.reserve]).map((card) => card.title)).toEqual([
      "Nvidia Reports Record Data Centre Revenue",
      "Nvidia and AMD Rise on New Chip Export Rules - Reuters",
    ]);
  });

  it("answer calmly when the store cannot be read", async () => {
    setSqlClient({ query: async () => Promise.reject(new Error("store down")) });
    try {
      expect(await loadNewsColumn()).toMatchObject({ stories: [], reason: "store unavailable" });
      expect(await loadListingNews()).toMatchObject({ items: [], reason: "store unavailable" });
    } finally {
      setSqlClient(sql);
    }
  });
});

describe("robustness (review, 2026-10-02)", () => {
  it("never leaves a story with no item when a copy outlives its lead's feed", async () => {
    const lead = { title: "Nvidia Reports Record Data Centre Revenue", by: "Reuters", hoursAgo: 24 * 10, link: "https://www.nasdaq.com/articles/record" };
    const copy = { ...lead, title: "Nvidia Reports Record Data Centre Revenue", by: "The Motley Fool", link: "https://www.nasdaq.com/articles/record?utm_source=amd" };
    await ingestNews({ phase: "slot", now: NOW, deps: deps({ fetcher: nasdaq({ NVDA: [lead], AMD: [copy] }) }) });
    // Ten days on, only the quiet feed still carries its copy.
    await ingestNews({ phase: "slot", now: NOW, deps: deps({ fetcher: nasdaq({ AMD: [copy] }) }) });
    const orphans = (await sql.query(`select count(*)::int as n from stories s where not exists (select 1 from story_sources ss where ss.story_id = s.id)`)) as { n: number }[];
    expect(orphans[0].n).toBe(0);
    expect(await count("stories")).toBe(1);
  });

  it("runs one ingest at a time: a second run while one holds the lease does nothing", async () => {
    const [a, b] = await Promise.all([
      ingestNews({ phase: "slot", now: NOW, deps: deps() }),
      ingestNews({ phase: "slot", now: NOW, deps: deps() }),
    ]);
    const skipped = [a, b].filter((one) => "skipped" in one.nasdaq && one.nasdaq.skipped === "another run holds the lease");
    expect(skipped).toHaveLength(1);
    expect(await count("stories")).toBe(4);
    // A lease left by a run that died is taken once it is old.
    expect(await takeIngestLease(Date.now(), 90_000)).toBe(true);
    expect(await takeIngestLease(Date.now(), 90_000)).toBe(false);
    expect(await takeIngestLease(Date.now() + 120_000, 90_000)).toBe(true);
  });

  it("frees only its own lease: a run overtaken after the lease ran out frees nothing", async () => {
    const stale = Date.now();
    expect(await takeIngestLease(stale, 90_000)).toBe(true);
    const successor = stale + 120_000;
    expect(await takeIngestLease(successor, 90_000)).toBe(true);
    // The slow first run finishes now and releases: the successor still holds it.
    await releaseIngestLease(stale);
    expect(await takeIngestLease(successor + 1_000, 90_000)).toBe(false);
    await releaseIngestLease(successor);
    expect(await takeIngestLease(successor + 2_000, 90_000)).toBe(true);
  });

  it("does not start pruning when the run is already past its deadline and grace", async () => {
    const summary = await ingestNews({ phase: "evening", now: NOW, deadline: Date.now() - 60_000, deps: deps() });
    expect(summary.pruned).toBe(false);
    expect(summary.failures).toContain("prune: out of time, the next cron prunes");
  });

  it("stops starting items at the deadline and still settles its reservations", async () => {
    const slow = (async (input: string | URL | Request, init?: RequestInit) => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return nasdaq(FEEDS)(input, init);
    }) as typeof fetch;
    const summary = await ingestNews({ phase: "slot", now: NOW, deadline: Date.now() + 15, deps: deps({ fetcher: slow }) });
    expect(summary.nasdaq).toMatchObject({ requests: 4, items: 0 });
    expect(summary.failures).toContain("nasdaq: out of time, the rest wait for the next run");
    expect(summary.judged).toEqual({ skipped: "out of time" });
    const day = new Date(NOW).toISOString().slice(0, 10);
    expect((await newsSpent("nasdaq", day)).reserved).toBe(0);
  });

  it("lets a failing write cost only its own stage", async () => {
    const broken = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).startsWith("https://data.sec.gov/")) return Response.json({ filings: { recent: { accessionNumber: ["x"], filingDate: ["not a date"], form: ["8-K"] } } });
      return nasdaq(FEEDS)(input, init);
    }) as typeof fetch;
    const summary = await ingestNews({ phase: "evening", now: NOW, deps: deps({ fetcher: broken, edgarPhases: ["evening"] }) });
    expect(summary.failures.some((failure) => failure.startsWith("edgar:"))).toBe(true);
    expect(summary.judged).toMatchObject({ answered: 5 });
    expect(summary.pruned).toBe(true);
  });

  it("asks X for new posts only from a reader's slot, never from a cron", async () => {
    const asked: boolean[] = [];
    const gather = async ({ mayFetch }: { mayFetch: boolean }) => {
      asked.push(mayFetch);
      return { posts: [], substance: new Map(), failures: [], curation: undefined, updatedAt: undefined } as GatheredPosts;
    };
    await ingestNews({ phase: "evening", now: NOW, deps: deps({ gather, mayFetchX: true }) });
    await ingestNews({ phase: "slot", now: NOW, deps: deps({ gather, mayFetchX: true }) });
    expect(asked).toEqual([false, true]);
  });

  it("reads a post once dropped and now kept as kept", async () => {
    const dropped: GatheredPosts = { posts: [], substance: new Map(), failures: [], curation: undefined, updatedAt: NOW, dropped: [post("300", "MSTR", "Strategy buys bitcoin", 1, "Strategy")] };
    const kept: GatheredPosts = { ...dropped, posts: [post("300", "MSTR", "Strategy buys bitcoin", 1, "Strategy")], substance: new Map([["300", 1.6]]), dropped: [] };
    await ingestNews({ phase: "slot", now: NOW, deps: deps({ gather: async () => dropped }) });
    await ingestNews({ phase: "slot", now: NOW, deps: deps({ gather: async () => kept }) });
    const rows = (await sql.query(`select kept, verdict from story_verdicts where symbol = 'MSTR'`)) as { kept: boolean; verdict: string }[];
    expect(rows).toEqual([{ kept: true, verdict: "material" }]);
    // And a later drop never undoes it.
    await ingestNews({ phase: "slot", now: NOW, deps: deps({ gather: async () => dropped }) });
    expect(((await sql.query(`select kept from story_verdicts where symbol = 'MSTR'`)) as { kept: boolean }[])[0].kept).toBe(true);
  });

  it("shows an amended filing like the filing it amends", async () => {
    const day = new Date(NOW - 24 * HOUR).toISOString().slice(0, 10);
    const edgar = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).startsWith("https://data.sec.gov/")) {
        return Response.json({ filings: { recent: { accessionNumber: [`a-${String(input).slice(-9, -5)}`], filingDate: [day], form: ["10-K/A"], primaryDocument: ["d.htm"] } } });
      }
      return nasdaq(FEEDS)(input, init);
    }) as typeof fetch;
    await ingestNews({ phase: "evening", now: NOW, deps: deps({ fetcher: edgar, edgarPhases: ["evening"] }) });
    const column = await loadNewsColumn();
    expect(column.events.find((event) => event.symbol === "NVDA")).toMatchObject({ form: "10-K/A", report: "annual" });
  });
});
