import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FirstLookResponse } from "@/lib/first-look";
import { setSqlClient, type SqlClient } from "@/lib/server/db";
import { makeTestDb } from "@/lib/server/pglite-test-db";
import { TOKEN_LISTINGS } from "@/lib/listings";

/**
 * /api/first-look end to end over the news store and the real headline
 * judge, with the network stubbed: it never calls Jev; a listing counts as
 * looked at only when ingestion already had Jev read its headlines (an
 * empty store is no look, never a quiet one); "in today's news" needs a
 * headline about the company, reporting something, not shaped like advice;
 * a large move comes from the marks with no post; and nothing at all
 * without a key.
 */

let sql: SqlClient;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ sql, close } = await makeTestDb());
  setSqlClient(sql);
});
afterAll(async () => {
  setSqlClient(null);
  await close();
});

// Noon in New York, so every fixture headline is from today there.
vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(new Date(Date.UTC(2026, 9, 1, 16)));

const store = vi.hoisted(() => new Map<string, unknown>());
vi.mock("next/cache", () => ({
  unstable_cache:
    <T>(work: () => Promise<T>, keyParts: string[]) =>
    async () => {
      const key = keyParts.join("|");
      if (store.has(key)) return store.get(key) as T;
      const value = await work();
      store.set(key, value);
      return value;
    },
}));

// Tesla's last day was large for it: thirty quiet days, then 5% down.
const quiet = Array.from({ length: 30 }, (_, index) => 100 + (index % 2) * 0.3);
vi.mock("@/lib/server/listing-performance", () => ({
  loadPerformance: vi.fn(async () => ({
    performance: {
      TSLA: { changePct: -5, series: [...quiet, quiet[quiet.length - 1] * 0.95] },
      NVDA: { changePct: 0.2, series: [...quiet, quiet[quiet.length - 1] * 1.002] },
    },
    seriesDays: 31,
  })),
}));

const HOUR = 60 * 60 * 1000;
const NOW = Date.now();

function rss(items: { title: string; hoursAgo: number }[]): string {
  return `<?xml version="1.0"?><rss><channel>${items
    .map(
      (item, index) =>
        `<item><title>${item.title}</title><link>https://www.nasdaq.com/articles/${index}-${encodeURIComponent(item.title)}</link><pubDate>${new Date(NOW - item.hoursAgo * HOUR).toUTCString()}</pubDate><dc:creator>Reuters</dc:creator></item>`,
    )
    .join("")}</channel></rss>`;
}

const FEEDS: Record<string, string> = {
  NVDA: rss([{ title: "Nvidia agrees to supply chips for a new OpenAI data centre", hoursAgo: 2 }]),
  // Only advice: Jev keeps it (it often reads ratings as news), the look does not.
  TSLA: rss([{ title: "Goldman Adds Tesla to Conviction List", hoursAgo: 1 }]),
  // Only loosely about Apple (about 0.5): the column keeps it, the look does not.
  AAPL: rss([{ title: "Chip makers rally as Apple supplier reports strong quarter", hoursAgo: 2 }]),
};

const jevCalls = vi.fn();
const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith("https://api.typesafe.ai")) {
    jevCalls(url);
    const loose = String(init?.body ?? "").includes("Apple supplier");
    return Response.json({
      answers: {
        about: { type: "noul", noul: loose ? 0.5 : 0.9 },
        substance: { type: "score", score: 3.4, probabilities: {}, confidence: 0.8 },
      },
    });
  }
  if (url.includes("symbol=MSFT")) return new Response("down", { status: 503 });
  const symbol = url.match(/symbol=([A-Z]+)/)?.[1] ?? "";
  return new Response(FEEDS[symbol] ?? rss([]));
});

const { GET } = await import("./route");
const { ingestNews } = await import("@/lib/server/news-ingest");

beforeEach(async () => {
  for (const table of ["stories", "jev_answers", "news_budget"]) await sql.query(`delete from ${table}`);
  store.clear();
  jevCalls.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("JEV_API_KEY", "test-key");
  vi.stubEnv("JEV_DISABLED", "");
  // Marketaux has its own test (news-marketaux.db.test); these runs never ask it.
  vi.stubEnv("MARKETAU_API_KEY", "");
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function look(query = ""): Promise<FirstLookResponse> {
  return (await (await GET(new Request(`http://localhost/api/first-look${query}`))).json()) as FirstLookResponse;
}

/** The news store's ingestion, which is what pays Jev. */
async function columnReads(...symbols: string[]) {
  await ingestNews({
    phase: "slot",
    deps: { listings: TOKEN_LISTINGS.filter((listing) => symbols.includes(listing.symbol)), fetcher: fetchMock as typeof fetch, edgarPhases: [] },
  });
}

describe("GET /api/first-look", () => {
  it("never asks Jev, and a cold cache is no look at all, never a quiet one", async () => {
    const body = await look();
    expect(jevCalls).not.toHaveBeenCalled();
    expect(body.judged).toBe(true);
    for (const symbol of ["SPY", "NVDA", "AAPL"]) expect(body.looks[symbol]).toEqual({ looked: false, inNews: false });
    // Tesla is not looked at either; only its move, from the marks, is there.
    expect(body.looks.TSLA).toEqual({ looked: false, inNews: false, movePct: -5 });
  });

  it("says in today's news only for a headline about the company that is not advice, and asks Jev nothing", async () => {
    await columnReads("NVDA", "TSLA", "AAPL", "SPY");
    const paid = jevCalls.mock.calls.length;
    expect(paid).toBeGreaterThan(0);

    const body = await look();
    expect(jevCalls).toHaveBeenCalledTimes(paid);
    expect(body.looks.NVDA).toEqual({ looked: true, inNews: true });
    expect(body.looks.TSLA).toEqual({ looked: true, inNews: false, movePct: -5 });
    expect(body.looks.AAPL).toEqual({ looked: true, inNews: false });
    // No headline, source or link leaves the route.
    expect(JSON.stringify(body)).not.toMatch(/Nvidia agrees|Conviction|Reuters|nasdaq\.com/);
  });

  it("reads the first stock card's stock when asked, and a feed that failed is no look", async () => {
    expect(Object.keys((await look("?also=AMZN")).looks)).toEqual(["SPY", "NVDA", "AAPL", "TSLA", "AMZN"]);
    await columnReads("MSFT");
    const body = await look("?also=MSFT");
    expect(body.looks.MSFT).toEqual({ looked: false, inNews: false });
  });

  it("leaves out every listing when the store cannot be read", async () => {
    setSqlClient({ query: async () => Promise.reject(new Error("down")) });
    try {
      expect((await look()).looks).toEqual({});
    } finally {
      setSqlClient(sql);
    }
  });

  it("does not log its cache misses as Jev leaving questions unanswered", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await look();
    const said = [...warn.mock.calls, ...info.mock.calls].map((call) => String(call[0]));
    expect(said.filter((line) => line.startsWith("[jev]"))).toEqual([]);
  });

  it("says nothing without a key", async () => {
    vi.stubEnv("JEV_API_KEY", "");
    const body = await look();
    expect(body).toMatchObject({ judged: false, looks: {} });
    expect(jevCalls).not.toHaveBeenCalled();
  });

  it("is cached briefly at the edge", async () => {
    expect((await GET(new Request("http://localhost/api/first-look"))).headers.get("cache-control")).toBe(
      "public, s-maxage=600, stale-while-revalidate=600",
    );
  });
});
