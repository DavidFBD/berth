import { TOKEN_LISTINGS } from "@/lib/listings";
import { mergeNews, type NewsItem } from "@/lib/news";
import { forListing } from "@/lib/news-stories";
import { lastIngestAt } from "@/lib/server/news-store";
import { readCards } from "@/lib/server/news-read";

/**
 * Headlines about the listings, newest first, as they were before the news
 * store, now read from it (lib/server/news-read). Served by
 * app/api/listing-news and read by the first look and the MCP tools.
 *
 * Nothing here fetches or asks Jev any more: ingestion (lib/server/
 * news-ingest) reads Nasdaq's feeds, folds the copies of a story into one
 * and has Jev judge each story once; this only reads what was stored. A
 * headline is an article story's lead, with its verdict for the listing it
 * is filed under. One Jev has not judged yet is kept without a verdict,
 * exactly as before Jev. Licensed sources only: nothing a source shows to
 * staff alone reaches the first look or an AI.
 *
 * Always 200: no headlines is a soft degrade the card renders as a quiet
 * spell, never an error.
 */

const FEED_LIMIT = 12;
const PER_SYMBOL_LIMIT = 2;
const SYMBOL_LIMIT = 8;
const WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export type ListingNewsResponse = {
  items: NewsItem[];
  /** When the store last took in news, epoch ms. */
  updatedAt?: number;
  /** How many stories in the window Jev judged for the listing (or all), and kept. Absent when it judged none. */
  judged?: { read: number; kept: number };
  /** Present only when something degraded, for the console. */
  reason?: string;
};

/** Headlines for every listing, or for one when `symbol` names it. Never throws. */
export async function loadListingNews(symbol?: string | null): Promise<ListingNewsResponse> {
  const wanted = symbol?.toUpperCase();
  if (wanted && !TOKEN_LISTINGS.some((listing) => listing.symbol === wanted)) {
    return { items: [], reason: `no listing called ${wanted}` };
  }
  try {
    const now = Date.now();
    const [{ cards, counts }, updatedAt] = await Promise.all([
      readCards({ sinceMs: now - WINDOW_MS, symbol: wanted }),
      lastIngestAt().catch(() => undefined),
    ]);
    const items: NewsItem[] = [];
    for (const card of cards) {
      if (card.kind !== "article") continue;
      // One listing's headlines carry that listing's own reading, or none
      // when Jev has not judged the story for it yet (lib/news-stories).
      const mine = wanted ? forListing(card, wanted) : card;
      if (!mine) continue;
      const item: NewsItem = {
        title: mine.title,
        url: mine.url,
        publishedAt: mine.publishedAt,
        source: mine.publisher,
        symbol: mine.symbol,
        name: mine.name,
      };
      if (mine.verdict) item.verdict = mine.verdict;
      if (mine.about !== undefined) item.about = mine.about;
      items.push(item);
    }
    const merged = mergeNews(items, { limit: wanted ? SYMBOL_LIMIT : FEED_LIMIT, perSymbol: wanted ? SYMBOL_LIMIT : PER_SYMBOL_LIMIT });
    const totals = wanted
      ? (counts[wanted] ?? { read: 0, kept: 0 })
      : Object.values(counts).reduce((sum, one) => ({ read: sum.read + one.read, kept: sum.kept + one.kept }), { read: 0, kept: 0 });
    const payload: ListingNewsResponse = { items: merged, updatedAt };
    if (totals.read > 0) payload.judged = totals;
    return payload;
  } catch (error) {
    console.warn("[listing-news]", error instanceof Error ? error.message : error);
    return { items: [], reason: "store unavailable" };
  }
}
