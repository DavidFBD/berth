import { unstable_cache } from "next/cache";
import { HEADLINES_WINDOW_MS, REFRESH_WINDOW_MS, slotOf } from "@/lib/feed-refresh";
import { TOKEN_LISTINGS, type TokenListing } from "@/lib/listings";
import {
  looksLikeTickerList,
  mergeNews,
  parseFeedItems,
  type NewsItem,
} from "@/lib/news";
import {
  JUDGE_VERSION,
  headlineQuestions,
  headlineState,
  keepHeadline,
  type HeadlineAnswers,
} from "@/lib/news-judge";
import { cachedVerdict, jevConfigured } from "@/lib/server/jev";

/**
 * Headlines about the listings, newest first. Served by app/api/listing-news
 * and read by the MCP server's get_listing (app/mcp).
 *
 * Source: Nasdaq's per-symbol RSS, one feed per ticker, which is the only
 * keyless feed that covers all thirteen and hands back a canonical link, a
 * real publisher name in `dc:creator` and a timestamp. What a reader gets is
 * a headline, who wrote it and when, and a link out. Never the article: the
 * text belongs to whoever wrote it.
 *
 * Deliberately not included, though the research called for them. The
 * issuers' own newsrooms have the cleanest rights of any source, being the
 * company's own words, but in practice they are the wrong words: NVIDIA's
 * feed is a marketing blog announcing cloud gaming titles, Apple's is
 * consumer product news, and both attribute to a staff username rather than
 * the company, while Tesla's and Sandisk's investor feeds were 49 and 14
 * days stale when this was built. Beside Nasdaq's two-hour-old wire copy
 * they would dilute the feed, not strengthen it. They belong next to a
 * single listing, where "Apple published this" is the point, and that is
 * where they should return.
 *
 * Google News search RSS covers the quiet funds better than anything else
 * and is left out on purpose: its terms restrict use to personal,
 * non-commercial viewing and forbid reformatting and display, and its links
 * are redirect tokens that cannot be resolved server side, so a reader would
 * be sent to Google rather than to the publisher.
 *
 * Licence standing, stated plainly because it is not settled: Nasdaq
 * publishes these feeds for syndication, and its own terms gate use "as part
 * of a commercial or value-added service" behind a Global Data Agreement.
 * Headline, publisher, time and a link out is the narrowest possible read of
 * that, and the seam here is one function wide so a licensed wire can take
 * its place in an afternoon. See
 * docs/research/2026-09-17-newsfeeds-and-price-history.md.
 *
 * Jev reads each listing's newest headlines (lib/news-judge) and drops the
 * two kinds Nasdaq's feeds are thick with: pieces that are not really about
 * the listing ("3 AI Stocks to Buy" filed under every name it mentions) and
 * pitches with no event behind them ("Should You Buy Nvidia Before
 * Earnings?"). Verdicts are cached for two weeks, so the quarter-hour refresh
 * pays only for headlines it has not seen. A headline Jev did not answer for
 * is kept, exactly as before Jev.
 *
 * Always 200: no headlines is a soft degrade the card renders as a quiet
 * spell, never an error.
 */

const NASDAQ_FEED = "https://www.nasdaq.com/feed/rssoutbound?symbol=";
/**
 * Nasdaq's feed answers a browser and times out on anything that announces
 * itself as a robot, so this is what actually gets a document back. One
 * request per ticker per quarter hour serves every visitor (lib/feed-refresh:
 * slot-keyed, so the first visitor of a morning gets this morning's feed, not
 * the last one fetched overnight), and the refresh button's five minutes at
 * most.
 */
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

/** How many cards the river carries, and how many any one name may take. */
const FEED_LIMIT = 12;
const PER_SYMBOL_LIMIT = 2;
/** Asking about one listing is a different question: show its own run. */
const SYMBOL_LIMIT = 8;

export type ListingNewsResponse = {
  items: NewsItem[];
  /** When the oldest of the feeds behind this was fetched, epoch ms. */
  updatedAt?: number;
  /** Present only when something degraded, for the console. */
  reason?: string;
};

async function fetchFeed(listing: TokenListing): Promise<{ fetchedAt: number; items: NewsItem[] }> {
  const fetchedAt = Date.now();
  const response = await fetch(`${NASDAQ_FEED}${listing.symbol}`, {
    headers: { "user-agent": USER_AGENT, accept: "application/rss+xml, text/xml" },
    // The slot's cache entry below is the only cache; an age-based one
    // underneath it would hand a new slot an old feed.
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Nasdaq answered ${response.status}`);
  const items = parseFeedItems(await response.text())
    .filter((item) => !looksLikeTickerList(item.title))
    .map((item) => ({
      ...item,
      source: item.source || "Nasdaq",
      symbol: listing.symbol,
      name: listing.name,
    }));
  return { fetchedAt, items };
}

/** One feed, once per slot for every visitor. A failure throws, so it is not kept. */
function readFeed(listing: TokenListing, fresh: boolean, now: number) {
  const windowMs = fresh ? REFRESH_WINDOW_MS : HEADLINES_WINDOW_MS;
  return unstable_cache(
    () => fetchFeed(listing),
    ["nasdaq-feed", listing.symbol, fresh ? "refresh" : "slot", String(slotOf(now, windowMs))],
    { revalidate: Math.ceil((windowMs * 2) / 1000) },
  )();
}

/** The newest this many per listing are read; a card never reaches further back. */
const JUDGE_PER_SYMBOL = 14;

async function judgeHeadlines(items: readonly NewsItem[]): Promise<NewsItem[]> {
  const questions = headlineQuestions();
  const newest = [...items].sort((a, b) => b.publishedAt - a.publishedAt);
  const counts = new Map<string, number>();
  const pool = newest.filter((item) => {
    const count = counts.get(item.symbol) ?? 0;
    counts.set(item.symbol, count + 1);
    return count < JUDGE_PER_SYMBOL;
  });
  const kept = await Promise.all(
    pool.map(async (item) => {
      const answers = (await cachedVerdict(
        JUDGE_VERSION,
        headlineState(item, item.symbol, item.name),
        questions,
      )) as HeadlineAnswers | undefined;
      return !answers || keepHeadline(answers) ? item : undefined;
    }),
  );
  return kept.filter((item): item is NewsItem => item !== undefined);
}

/** Headlines for every listing, or for one when `symbol` names it. Never throws. */
export async function loadListingNews(
  symbol?: string | null,
  { fresh = false }: { fresh?: boolean } = {},
): Promise<ListingNewsResponse> {
  const wanted = symbol?.toUpperCase();
  const listings = wanted
    ? TOKEN_LISTINGS.filter((listing) => listing.symbol === wanted)
    : TOKEN_LISTINGS;

  if (listings.length === 0) {
    return { items: [], reason: `no listing called ${wanted}` };
  }

  const now = Date.now();
  const results = await Promise.allSettled(listings.map((listing) => readFeed(listing, fresh, now)));
  const gathered: NewsItem[] = [];
  const failures: string[] = [];
  const fetched: number[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      gathered.push(...result.value.items);
      fetched.push(result.value.fetchedAt);
    }
    else {
      failures.push(
        result.reason instanceof Error
          ? result.reason.message
          : "feed request failed",
      );
    }
  }

  const judged = jevConfigured() ? await judgeHeadlines(gathered) : gathered;

  const payload: ListingNewsResponse = {
    items: mergeNews(judged, {
      limit: wanted ? SYMBOL_LIMIT : FEED_LIMIT,
      // One listing asked about may fill its own card entirely.
      perSymbol: wanted ? SYMBOL_LIMIT : PER_SYMBOL_LIMIT,
    }),
    // The oldest, so "Updated" never claims more freshness than every feed has.
    updatedAt: fetched.length ? Math.min(...fetched) : undefined,
  };
  if (failures.length > 0) payload.reason = [...new Set(failures)].join("; ");
  return payload;
}
