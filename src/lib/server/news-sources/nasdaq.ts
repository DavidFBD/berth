import type { TokenListing } from "@/lib/listings";
import { parseFeedItems } from "@/lib/news";
import type { IngestItem } from "@/lib/server/news-store";

/**
 * Nasdaq's per-symbol RSS, one feed per ticker: the only keyless feed that
 * covers every listing and hands back a canonical link, a real publisher in
 * `dc:creator` and a timestamp. Only the headline, who wrote it, when, and a
 * link out are kept; never the article.
 *
 * Licence standing, stated plainly because it is not settled: Nasdaq
 * publishes these feeds for syndication, and its own terms gate use "as part
 * of a commercial or value-added service" behind a Global Data Agreement.
 * Headline, publisher, time and a link out is the narrowest read of that.
 * See docs/research/2026-09-17-newsfeeds-and-price-history.md.
 *
 * Why not the issuers' newsrooms or Google News: argued in the history of
 * lib/server/listing-news (marketing blogs and stale investor feeds; Google's
 * terms forbid reformatting and its links cannot be resolved).
 */

const NASDAQ_FEED = "https://www.nasdaq.com/feed/rssoutbound?symbol=";
/** Nasdaq answers a browser and times out on anything that announces itself as a robot. */
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

/** One listing's feed as store items. Throws when Nasdaq does not answer. */
export async function fetchNasdaq(listing: TokenListing, fetcher: typeof fetch = fetch): Promise<IngestItem[]> {
  const response = await fetcher(`${NASDAQ_FEED}${listing.symbol}`, {
    headers: { "user-agent": USER_AGENT, accept: "application/rss+xml, text/xml" },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Nasdaq answered ${response.status}`);
  return parseFeedItems(await response.text()).map((item) => ({
    source: "nasdaq" as const,
    // The link is the item's identity: Nasdaq gives no guid worth more.
    sourceId: item.url,
    title: item.title,
    url: item.url,
    publisher: item.source || "Nasdaq",
    publishedAt: item.publishedAt,
    symbols: [listing.symbol],
    taggedBy: "feed" as const,
  }));
}
