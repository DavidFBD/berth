import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setSqlClient, type SqlClient } from "@/lib/server/db";
import { makeTestDb } from "@/lib/server/pglite-test-db";
import { TOKEN_LISTINGS } from "@/lib/listings";

/**
 * Marketaux through every surface, against the real schema: one story only
 * Marketaux carried (Apple) and one it shares with Nasdaq (NVIDIA), ingested
 * once, then read in each mode by the news column (staff and not), the
 * first look, the MCP get_listing tool, the nudge and the moves. Plus the
 * ingest's own limits: four listings a call, twenty articles, the daily cap
 * and the per-minute limit reserved before a request, and each run asking
 * only since the last.
 */

vi.mock("@/lib/server/portfolio", () => ({ liveListingPrices: vi.fn(async () => ({})) }));
vi.mock("@/lib/server/listing-performance", () => ({ loadPerformance: vi.fn(async () => ({ performance: {} })) }));
vi.mock("@/lib/server/listing-x", () => ({ loadListingX: vi.fn(async () => ({ items: [], reserve: [] })) }));
vi.mock("@/lib/server/x-column", () => ({ gatherPosts: vi.fn(async () => ({ posts: [] })) }));

const { ingestNews } = await import("@/lib/server/news-ingest");
const { newsSpent } = await import("@/lib/server/news-store");
const { loadNewsColumn, readCards } = await import("@/lib/server/news-read");
const { loadListingNews } = await import("@/lib/server/listing-news");
const { loadFirstLook } = await import("@/lib/server/first-look");
const { postsFromCards } = await import("@/lib/server/moves");
const { heldNewsFor } = await import("@/lib/server/nudge");
const { BERTH_TOOLS } = await import("@/lib/server/berth-tools/registry");

let sql: SqlClient;
let close: () => Promise<void>;

const HOUR = 60 * 60 * 1000;
const NOW = Date.now();
const DAY = new Date(NOW).toISOString().slice(0, 10);
const LISTINGS = TOKEN_LISTINGS.filter((listing) => ["NVDA", "AMD", "AAPL", "MSTR", "TSLA"].includes(listing.symbol));

const SHARED = "Nvidia Expands Partnership With Dell on AI Servers";
const ONLY = "Apple Signs Record Supply Deal With Foxconn";

beforeAll(async () => {
  ({ sql, close } = await makeTestDb());
  setSqlClient(sql);
});

afterAll(async () => {
  setSqlClient(null);
  await close();
});

const jevBodies: string[] = [];
const marketauxUrls: URL[] = [];

function rss(title: string, by: string, hoursAgo: number, link: string): string {
  return `<?xml version="1.0"?><rss><channel><item><title>${title}</title><link>${link}</link><pubDate>${new Date(
    NOW - hoursAgo * HOUR,
  ).toUTCString()}</pubDate><dc:creator>${by}</dc:creator></item></channel></rss>`;
}

const ARTICLES = [
  {
    uuid: "mx-shared",
    title: SHARED,
    description: "A description Berth must never keep.",
    snippet: "A snippet Berth must never keep.",
    image_url: "https://img.example/dell.jpg",
    url: "https://www.gurufocus.com/news/nvidia-dell",
    source: "gurufocus.com",
    language: "en",
    published_at: new Date(NOW - 2 * HOUR).toISOString(),
    entities: [{ symbol: "NVDA", match_score: 55, sentiment_score: 0.81 }],
  },
  {
    uuid: "mx-only",
    title: ONLY,
    description: "A description Berth must never keep.",
    snippet: "A snippet Berth must never keep.",
    image_url: "https://img.example/foxconn.jpg",
    url: "https://www.gurufocus.com/news/apple-foxconn",
    source: "gurufocus.com",
    language: "en",
    published_at: new Date(NOW - HOUR).toISOString(),
    entities: [{ symbol: "AAPL", match_score: 70, sentiment_score: 0.9 }],
  },
];

type Article = (typeof ARTICLES)[number];

/** Marketaux as it answers: newest first, inside published_after and published_before, a page of `limit`, with meta.found. */
function answer(url: URL, articles: readonly Article[]): Response {
  const asked = (url.searchParams.get("symbols") ?? "").split(",");
  const after = Date.parse(`${url.searchParams.get("published_after")}Z`);
  const beforeParam = url.searchParams.get("published_before");
  const before = beforeParam ? Date.parse(`${beforeParam}Z`) : Number.POSITIVE_INFINITY;
  const inWindow = articles
    .filter((article) => article.entities.some((entity) => asked.includes(entity.symbol)))
    .filter((article) => Date.parse(article.published_at) > after && Date.parse(article.published_at) < before)
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));
  const page = inWindow.slice(0, Number(url.searchParams.get("limit") ?? 3));
  return Response.json({ meta: { found: inWindow.length, returned: page.length, limit: 20, page: 1 }, data: page });
}

/** What Marketaux answers in a test; each test may set its own. */
let marketaux: (url: URL) => Response = (url) => answer(url, ARTICLES);

const fetcher = (async (input: string | URL | Request) => {
  const url = new URL(String(input));
  if (url.hostname === "api.marketaux.com") {
    marketauxUrls.push(url);
    return marketaux(url);
  }
  const symbol = url.searchParams.get("symbol");
  if (symbol === "NVDA") return new Response(rss(SHARED, "Reuters", 3, "https://www.nasdaq.com/articles/nvidia-dell"));
  return new Response(`<?xml version="1.0"?><rss><channel></channel></rss>`);
}) as typeof fetch;

beforeEach(async () => {
  for (const table of ["stories", "jev_answers", "news_fetch_slots", "news_budget", "listing_events"]) await sql.query(`delete from ${table}`);
  await sql.query(`delete from news_cursors`);
  jevBodies.length = 0;
  marketauxUrls.length = 0;
  marketaux = (url) => answer(url, ARTICLES);
  vi.stubEnv("JEV_API_KEY", "test-key");
  vi.stubEnv("JEV_DISABLED", "");
  vi.stubEnv("JEV_DAILY_TOKEN_CAP", "");
  vi.stubEnv("MARKETAU_API_KEY", "test-marketaux-key");
  vi.stubEnv("NEWS_MARKETAUX", "");
  vi.stubEnv("MARKETAUX_DAILY_CAP", "");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (!String(input).startsWith("https://api.typesafe.ai")) throw new Error(`unexpected fetch ${String(input)}`);
      const body = String(init?.body ?? "");
      jevBodies.push(body);
      const record = body.toLowerCase().includes("record");
      // The moves' question: which post goes with the move.
      if (body.includes("could plausibly be related")) {
        return Response.json({ answers: { related: { type: "choice", choice: "post0", probabilities: { post0: 0.9 }, confidence: 0.8 } } });
      }
      return Response.json({
        answers: {
          about: { type: "noul", noul: 0.92 },
          substance: { type: "score", score: record ? 3.8 : 3.0, probabilities: {}, confidence: 0.8 },
          same: { type: "noul", noul: 0.1 },
        },
      });
    }),
  );
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

const ingest = (phase: "slot" | "evening" = "slot") =>
  ingestNews({ phase, now: NOW, deps: { listings: LISTINGS, fetcher, edgarPhases: [], sleep: async () => undefined } });

describe("Marketaux ingestion", () => {
  it("asks four listings a call for twenty articles, keeps only title, link, publisher, time and listings, and folds a shared copy under the licensed lead", async () => {
    const summary = await ingest();
    // Five stocks, four a call: two requests.
    expect(summary.marketaux).toMatchObject({ requests: 2, items: 2, added: 1, folded: 1 });
    expect(marketauxUrls).toHaveLength(2);
    expect(marketauxUrls.map((url) => url.searchParams.get("symbols")!.split(",").length).sort()).toEqual([1, 4]);
    for (const url of marketauxUrls) expect(url.searchParams.get("limit")).toBe("20");

    const stories = (await sql.query(`select title, publisher, publisher_count, symbols from stories order by title`)) as {
      title: string;
      publisher: string;
      publisher_count: number;
      symbols: string[];
    }[];
    expect(stories).toEqual([
      { title: ONLY, publisher: "GuruFocus", publisher_count: 1, symbols: ["AAPL"] },
      { title: SHARED, publisher: "Reuters", publisher_count: 2, symbols: ["NVDA"] },
    ]);
    const stored = JSON.stringify(await sql.query(`select * from story_sources where source = 'marketaux'`));
    for (const never of ["description", "snippet", "img.example", "sentiment", "0.81"]) expect(stored).not.toContain(never);

    // Jev reads the Marketaux-only headline like any other (David, 2026-10-02).
    expect(jevBodies.some((body) => body.includes("Foxconn"))).toBe(true);
    expect(await newsSpent("marketaux", DAY)).toEqual({ used: 2, reserved: 0, requests: 2 });
  });

  it("asks a later run only for what came since each group was last heard, with two hours' overlap", async () => {
    await ingest();
    const first = Date.parse(`${marketauxUrls[0].searchParams.get("published_after")}Z`);
    expect(NOW - first).toBeGreaterThanOrEqual(24 * HOUR - 60_000);
    marketauxUrls.length = 0;
    await ingest();
    expect(marketauxUrls).toHaveLength(2);
    for (const url of marketauxUrls) {
      const since = Date.parse(`${url.searchParams.get("published_after")}Z`);
      expect(Date.now() - since).toBeLessThan(2 * HOUR + 60_000);
      expect(Date.now() - since).toBeGreaterThan(2 * HOUR - 60_000);
    }
  });

  it("stops at the day's cap and at the minute's limit, reserved before a request is sent", async () => {
    vi.stubEnv("MARKETAUX_DAILY_CAP", "1");
    const capped = await ingest();
    expect(capped.marketaux).toMatchObject({ requests: 1 });
    expect(capped.failures).toContain("marketaux: day's cap of 1 reached, 1 of 2 groups wait");
    const again = await ingest();
    expect(again.marketaux).toEqual({ skipped: "day's cap of 1 reached" });
    expect(marketauxUrls).toHaveLength(1);
    expect(await newsSpent("marketaux", DAY)).toEqual({ used: 1, reserved: 0, requests: 1 });

    vi.stubEnv("MARKETAUX_DAILY_CAP", "");
    const minute = new Date().toISOString().slice(0, 16);
    await sql.query(`insert into news_budget (source, day, used) values ('marketaux-minute', $1, 30) on conflict (source, day) do update set used = 30`, [minute]);
    const limited = await ingest();
    // Unless the clock just turned a minute, the limit holds.
    if (new Date().toISOString().slice(0, 16) === minute) {
      expect(limited.marketaux).toEqual({ skipped: "minute's limit reached" });
      expect(marketauxUrls).toHaveLength(1);
    }
  });

  /** `count` NVIDIA notes, one every quarter hour back from an hour ago, each its own story. */
  const many = (count: number): Article[] =>
    Array.from({ length: count }, (_, index) => ({
      ...ARTICLES[0],
      uuid: `mx-many-${index}`,
      title: `Nvidia Note ${index + 1} on Data Centres`,
      url: `https://www.gurufocus.com/news/nvidia-note-${index + 1}`,
      published_at: new Date(NOW - HOUR - index * 15 * 60_000).toISOString(),
    }));
  const stored = async () =>
    Number(((await sql.query(`select count(*)::int as n from story_sources where source = 'marketaux'`)) as { n: number }[])[0].n);
  const cursor = async (key: string) =>
    ((await sql.query(`select covered_to, paging_top, paging_before from news_cursors where source = 'marketaux' and key = $1`, [key])) as {
      covered_to: unknown;
      paging_top: unknown;
      paging_before: unknown;
    }[])[0];
  // Five stocks in the registry's order, four a call, each group sorted.
  const NVDA_GROUP = "AAPL,MSTR,NVDA,TSLA";
  const OTHER_GROUP = "AMD";

  it("pages back on a full page until meta.found is covered: 80 found, 20 a page, all 80 kept", async () => {
    marketaux = (url) => answer(url, many(80));
    const summary = await ingest();
    // Each page back starts a second past the oldest, so one article a page is asked twice
    // (and is "known"): five pages for the NVIDIA group, one for the other.
    expect(summary.marketaux).toMatchObject({ requests: 6, added: 80 });
    expect(await stored()).toBe(80);
    const pages = marketauxUrls.filter((url) => url.searchParams.get("symbols") === NVDA_GROUP);
    expect(pages.map((url) => url.searchParams.has("published_before"))).toEqual([false, true, true, true, true]);
    for (const url of pages) expect(url.searchParams.get("limit")).toBe("20");
    const row = await cursor(NVDA_GROUP);
    expect(row.covered_to).not.toBeNull();
    expect(row.paging_top).toBeNull();
    expect(row.paging_before).toBeNull();
  });

  it("a run stopped part way through a window leaves it uncovered, and the next run resumes where it stopped", async () => {
    marketaux = (url) => answer(url, many(80));
    vi.stubEnv("MARKETAUX_DAILY_CAP", "3");
    const stopped = await ingest();
    expect(stopped.marketaux).toMatchObject({ requests: 3 });
    expect(stopped.failures.some((failure) => failure.startsWith("marketaux: day's cap of 3 reached"))).toBe(true);
    const held = await cursor(NVDA_GROUP);
    // Not covered: the window's top and the next page's bound are kept, covered_to has not moved.
    expect(held.covered_to).toBeNull();
    expect(held.paging_top).not.toBeNull();
    expect(held.paging_before).not.toBeNull();
    const kept = await stored();
    expect(kept).toBeLessThan(80);

    vi.stubEnv("MARKETAUX_DAILY_CAP", "");
    marketauxUrls.length = 0;
    await ingest();
    const resumed = marketauxUrls.find((url) => url.searchParams.get("symbols") === NVDA_GROUP)!;
    expect(Date.parse(`${resumed.searchParams.get("published_before")}Z`)).toBe(new Date(held.paging_before as string).getTime());
    expect(await stored()).toBe(80);
    expect((await cursor(NVDA_GROUP)).paging_top).toBeNull();
  });

  it("an outage or a 429 on one group costs only that group, whose window does not move", async () => {
    marketaux = (url) => (url.searchParams.get("symbols") === NVDA_GROUP ? new Response("slow down", { status: 429 }) : answer(url, ARTICLES));
    const summary = await ingest();
    expect(summary.failures).toContain(`marketaux ${NVDA_GROUP}: Marketaux answered 429`);
    expect(summary.nasdaq).toMatchObject({ added: 1 });
    expect(await cursor(NVDA_GROUP)).toBeUndefined();
    expect(await cursor(OTHER_GROUP)).toBeDefined();
    // Every request sent is spent, answered or not.
    expect(await newsSpent("marketaux", DAY)).toEqual({ used: 2, reserved: 0, requests: 2 });

    marketaux = () => {
      throw new Error("network down");
    };
    marketauxUrls.length = 0;
    const down = await ingest();
    expect(down.failures).toContain(`marketaux ${NVDA_GROUP}: network down`);
    // The failed group asks its whole day again next time.
    const again = marketauxUrls.find((url) => url.searchParams.get("symbols") === NVDA_GROUP)!;
    expect(NOW - Date.parse(`${again.searchParams.get("published_after")}Z`)).toBeGreaterThan(23 * HOUR);
  });

  it("starts at a different group each hour, so a stopped run does not starve the same listings", async () => {
    vi.stubEnv("MARKETAUX_DAILY_CAP", "1");
    const hour = Math.floor(NOW / HOUR) * HOUR;
    const firstAsked = async (now: number) => {
      await sql.query(`delete from news_budget`);
      marketauxUrls.length = 0;
      await ingestNews({ phase: "slot", now, deadline: Date.now() + 50_000, deps: { listings: LISTINGS, fetcher, edgarPhases: [] } });
      return marketauxUrls.map((url) => url.searchParams.get("symbols"));
    };
    const one = await firstAsked(hour + 1);
    const two = await firstAsked(hour + HOUR + 1);
    expect(one).toHaveLength(1);
    expect(two).toHaveLength(1);
    expect(new Set([...one, ...two])).toEqual(new Set([NVDA_GROUP, OTHER_GROUP]));
  });

  it("asks nothing when switched off", async () => {
    vi.stubEnv("NEWS_MARKETAUX", "off");
    const summary = await ingest();
    expect(summary.marketaux).toEqual({ skipped: "off" });
    expect(marketauxUrls).toHaveLength(0);
  });
});

describe("the moves, with a real move", () => {
  it("offer the X post about the move and never a Marketaux headline, though Marketaux carried one about it", async () => {
    const { loadMoves } = await import("@/lib/server/moves");
    const xPost = {
      id: "900",
      text: "Apple confirms its supply deal with Foxconn for the next iPhone",
      publishedAt: NOW - 2 * HOUR,
      author: { name: "Apple", username: "Apple", avatarUrl: "https://pbs.twimg.com/a.jpg" },
      url: "https://x.com/Apple/status/900",
      likes: 3,
      retweets: 1,
      quotes: 0,
      replies: 0,
      symbol: "AAPL",
      name: "Apple",
    };
    await ingestNews({
      phase: "slot",
      now: NOW,
      deps: {
        listings: LISTINGS,
        fetcher,
        edgarPhases: [],
        gather: async () => ({ posts: [xPost], substance: new Map([["900", 0.4 + 3.6 * 0.3]]), failures: [], curation: undefined, updatedAt: NOW }),
      },
    });
    const today = new Date(NOW).toISOString().slice(0, 10);
    const dates = Array.from({ length: 30 }, (_, index) => new Date(NOW - (29 - index) * 24 * HOUR).toISOString().slice(0, 10));
    const series = [...Array.from({ length: 29 }, (_, index) => 200 + (index % 2 === 0 ? 0.5 : -0.5)), 230];
    expect(dates.at(-1)).toBe(today);
    const performance = Promise.resolve({ performance: { AAPL: { series, seriesDates: dates, changePct: 15 } } });
    const moves = await loadMoves({ performance: performance as never });
    expect(moves.moves).toEqual([
      expect.objectContaining({ symbol: "AAPL", post: expect.objectContaining({ url: "https://x.com/Apple/status/900" }) }),
    ]);
    const asked = jevBodies.find((body) => body.includes("could plausibly be related"))!;
    expect(asked).toContain("Apple confirms its supply deal");
    // The Marketaux headline about the same company is never offered.
    expect(asked).not.toContain(ONLY);
  });
});

describe("Marketaux on every surface, per mode", () => {
  const getListing = BERTH_TOOLS.find((tool) => tool.name === "get_listing")!;
  const mcp = async (listing: string) =>
    (await getListing.run({ listing } as never, { userId: null, scopes: [], origin: "https://www.berthmarkets.com", surface: "mcp" })).text;
  const facts = { held: ["NVDA", "AAPL"], funds: false, canInvite: false } as Parameters<typeof heldNewsFor>[0];
  const titles = (cards: { title: string }[]) => cards.map((card) => card.title).sort();

  async function surfaces() {
    const column = await loadNewsColumn();
    const staffColumn = await loadNewsColumn({ staff: true });
    const { cards } = await readCards({ sinceMs: Date.now() - 36 * HOUR });
    const look = await loadFirstLook({ also: "NVDA" });
    return {
      column: titles([...column.stories, ...column.reserve]),
      columnShared: [...column.stories, ...column.reserve].find((card) => card.title === SHARED),
      staffColumn: titles([...staffColumn.stories, ...staffColumn.reserve]),
      staffShared: [...staffColumn.stories, ...staffColumn.reserve].find((card) => card.title === SHARED),
      listingNews: titles([...(await loadListingNews("NVDA")).items, ...(await loadListingNews("AAPL")).items]),
      firstLook: look.looks,
      mcp: `${await mcp("NVDA")}\n${await mcp("AAPL")}`,
      nudge: titles(heldNewsFor(facts, cards)),
      moves: postsFromCards(cards).posts,
    };
  }

  beforeEach(async () => {
    // Ingested once with Marketaux on; each mode then reads the same rows.
    await ingest();
  });

  it("everyone (the default): both stories reach every surface, and the shared one names Marketaux's publisher", async () => {
    const seen = await surfaces();
    expect(seen.column).toEqual([ONLY, SHARED]);
    expect(seen.staffColumn).toEqual([ONLY, SHARED]);
    expect(seen.columnShared).toMatchObject({ publisher: "Reuters", alsoReportedBy: [{ publisher: "GuruFocus", url: "https://www.gurufocus.com/news/nvidia-dell" }] });
    expect(seen.listingNews).toEqual([ONLY, SHARED]);
    expect(seen.firstLook.AAPL).toMatchObject({ looked: true, inNews: true });
    expect(seen.firstLook.NVDA).toMatchObject({ looked: true, inNews: true });
    expect(seen.mcp).toContain(ONLY);
    expect(seen.mcp).toContain(SHARED);
    // Material, and a fact two publishers carried.
    expect(seen.nudge).toEqual([ONLY, SHARED]);
    expect(seen.moves).toEqual([]);
  });

  it("staff: the Marketaux-only story reaches the staff column alone; the shared one shows through Nasdaq elsewhere", async () => {
    vi.stubEnv("NEWS_MARKETAUX", "staff");
    const seen = await surfaces();
    expect(seen.column).toEqual([SHARED]);
    expect(seen.columnShared?.alsoReportedBy).toEqual([]);
    expect(seen.staffColumn).toEqual([ONLY, SHARED]);
    expect(seen.staffShared?.alsoReportedBy).toEqual([{ publisher: "GuruFocus", url: "https://www.gurufocus.com/news/nvidia-dell" }]);
    expect(seen.listingNews).toEqual([SHARED]);
    expect(seen.firstLook.AAPL).toMatchObject({ looked: false, inNews: false });
    expect(seen.firstLook.NVDA).toMatchObject({ looked: true, inNews: true });
    expect(seen.mcp).not.toContain(ONLY);
    expect(seen.mcp).not.toContain("gurufocus");
    expect(seen.mcp).toContain(SHARED);
    // The shared fact counts one publisher here, so it is not a line.
    expect(seen.nudge).toEqual([]);
    expect(seen.moves).toEqual([]);
  });

  it("off: what Marketaux gave reaches no one, the shared story only through Nasdaq", async () => {
    vi.stubEnv("NEWS_MARKETAUX", "off");
    const seen = await surfaces();
    expect(seen.column).toEqual([SHARED]);
    expect(seen.staffColumn).toEqual([SHARED]);
    expect(seen.staffShared?.alsoReportedBy).toEqual([]);
    expect(seen.listingNews).toEqual([SHARED]);
    expect(seen.firstLook.AAPL).toMatchObject({ looked: false, inNews: false });
    expect(seen.mcp).not.toContain(ONLY);
    expect(seen.mcp).not.toContain("gurufocus");
    expect(seen.nudge).toEqual([]);
    expect(seen.moves).toEqual([]);
  });
});
