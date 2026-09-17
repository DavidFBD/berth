import { TOKEN_LISTINGS, type TokenListing } from "@/lib/listings";
import {
  looksLikeTickerList,
  mergeNews,
  parseFeedItems,
  type NewsItem,
} from "@/lib/news";

/**
 * Headlines about the listings, newest first.
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
 * Always 200: no headlines is a soft degrade the card renders as a quiet
 * spell, never an error.
 */

const NASDAQ_FEED = "https://www.nasdaq.com/feed/rssoutbound?symbol=";
const REVALIDATE_SECONDS = 900;
/**
 * Nasdaq's feed answers a browser and times out on anything that announces
 * itself as a robot, so this is what actually gets a document back. One
 * request per ticker per quarter hour serves every visitor.
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
  /** Present only when something degraded, for the console. */
  reason?: string;
};

async function readFeed(listing: TokenListing): Promise<NewsItem[]> {
  const response = await fetch(`${NASDAQ_FEED}${listing.symbol}`, {
    headers: { "user-agent": USER_AGENT, accept: "application/rss+xml, text/xml" },
    next: { revalidate: REVALIDATE_SECONDS },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Nasdaq answered ${response.status}`);
  return parseFeedItems(await response.text())
    .filter((item) => !looksLikeTickerList(item.title))
    .map((item) => ({
      ...item,
      source: item.source || "Nasdaq",
      symbol: listing.symbol,
      name: listing.name,
    }));
}

export async function GET(request: Request): Promise<Response> {
  const wanted = new URL(request.url).searchParams.get("symbol")?.toUpperCase();
  const listings = wanted
    ? TOKEN_LISTINGS.filter((listing) => listing.symbol === wanted)
    : TOKEN_LISTINGS;

  if (listings.length === 0) {
    return Response.json({ items: [], reason: `no listing called ${wanted}` });
  }

  const results = await Promise.allSettled(listings.map(readFeed));
  const gathered: NewsItem[] = [];
  const failures: string[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") gathered.push(...result.value);
    else {
      failures.push(
        result.reason instanceof Error
          ? result.reason.message
          : "feed request failed",
      );
    }
  }

  const payload: ListingNewsResponse = {
    items: mergeNews(gathered, {
      limit: wanted ? SYMBOL_LIMIT : FEED_LIMIT,
      // One listing asked about may fill its own card entirely.
      perSymbol: wanted ? SYMBOL_LIMIT : PER_SYMBOL_LIMIT,
    }),
  };
  if (failures.length > 0) payload.reason = [...new Set(failures)].join("; ");
  return Response.json(payload);
}
