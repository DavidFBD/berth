/**
 * Pure core of the newsfeed: turning a feed document into items, throwing
 * away what is not news, and saying how long ago something happened.
 *
 * No fetching and no React here. The parser is deliberately small and
 * tolerant rather than a real XML implementation: it reads RSS 2.0 and Atom,
 * which is every feed the app subscribes to, and a malformed document costs
 * its own source's items and nothing else.
 */

/** One story, as the app carries it. */
export type NewsItem = {
  title: string;
  url: string;
  /** Epoch milliseconds. */
  publishedAt: number;
  /** Who published it: "The Motley Fool", "NVIDIA". */
  source: string;
  /** The listing this was fetched for. */
  symbol: string;
  /** That listing's plain name, for the chip on the card. */
  name: string;
  /** Jev's reading of the headline, as on a post (lib/news-judge). Absent when Jev did not read it. */
  verdict?: "material" | "fact" | "analysis";
  /**
   * How surely Jev read the headline as mainly about this listing, 0 to 1
   * (the "about" Noul). Absent when Jev did not read it. The column keeps a
   * named headline from 0.35; the first look asks for far more.
   */
  about?: number;
};

/** What a feed document yields before a listing is attached to it. */
export type FeedItem = Omit<NewsItem, "symbol" | "name">;

const BLOCK = /<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi;

/**
 * Exported for the X column too: the API hands back post text with its
 * ampersands and angle brackets escaped, and rendering "Import &amp; Export"
 * would be showing the transport rather than the words. Decoding restores
 * what the author typed, which is the opposite of editing it.
 */
export function decodeEntities(text: string): string {
  return (
    text
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
        String.fromCodePoint(Number.parseInt(code, 16)),
      )
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&(?:apos|#39);/g, "'")
      .replace(/&nbsp;/g, " ")
      // Ampersand last, or "&amp;lt;" would decode twice into a tag.
      .replace(/&amp;/g, "&")
  );
}

/** The text of a tag, entities decoded, inner markup and whitespace gone. */
function tagText(block: string, ...names: string[]): string | undefined {
  for (const name of names) {
    const match = block.match(
      new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"),
    );
    if (match) {
      const text = decodeEntities(match[1])
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (text) return text;
    }
  }
  return undefined;
}

/**
 * Items from one RSS or Atom document, in the order the feed gave them.
 *
 * An item without a title, a usable link or a date it can be placed by is
 * dropped: the card has nothing to say without all three, and a story with
 * no time cannot be sorted against the rest.
 */
export function parseFeedItems(xml: string): FeedItem[] {
  const items: FeedItem[] = [];
  for (const [, , block] of xml.matchAll(BLOCK)) {
    const title = tagText(block, "title");
    // RSS puts the URL in the element, Atom in a href attribute.
    const url =
      tagText(block, "link") ??
      block.match(/<link\b[^>]*href=["']([^"']+)["']/i)?.[1];
    const stamp = tagText(block, "pubDate", "published", "updated", "dc:date");
    const publishedAt = stamp ? Date.parse(stamp) : Number.NaN;
    // A web address and nothing else: "httpx:" or any other scheme is not a link.
    if (!title || !url || !/^https?:\/\//i.test(decodeEntities(url).trim())) continue;
    if (!Number.isFinite(publishedAt)) continue;
    items.push({
      title,
      url: decodeEntities(url).trim(),
      publishedAt,
      source: tagText(block, "dc:creator", "author", "source") ?? "",
    });
  }
  return items;
}

/**
 * Whether a headline is really a list of tickers wearing a headline's
 * clothes: "Pre-Market Most Active for Sep 1, 2026 : NIO, RZLV, TQQQ, SQQQ,
 * WFC, NVDA, NOK, IBIT, TSLL, PFE, SGOV, BMNR". Nasdaq's per-symbol feeds
 * carry a few of these a week and they tell a reader nothing about the
 * company.
 *
 * Counted rather than pattern-matched, so it catches the next variation of
 * the format too: four or more bare ticker-shaped words in one title is not
 * a sentence about a business. Real headlines carry at most an "AI" or a
 * "CEO", and the count ignores the first word, where a sentence may open on
 * a company's own ticker.
 */
export function looksLikeTickerList(title: string): boolean {
  const words = title.split(/[\s,:;()[\]]+/).filter(Boolean);
  const tickers = words
    .slice(1)
    .filter((word) => /^[A-Z]{2,5}$/.test(word.replace(/[.'’]/g, "")));
  return tickers.length >= 4;
}

/** Normalised title, for telling the same story from two sources apart. */
function titleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * One card per story, newest first, with room kept for more than one name.
 *
 * Two rules, in this order. The same piece reaches the app more than once,
 * because a wire runs on several Nasdaq symbol feeds at once, so the first
 * copy of a title wins and ordering the input by the source you trust most
 * decides which link a reader follows.
 *
 * Then breadth. Sorted on time alone the river is whatever moved this
 * morning, which in practice is the three largest companies: the feeds for
 * the big names run hours old while an index fund's run a day old, so a
 * straight sort buries every quieter listing forever. `perSymbol` caps how
 * many any one listing may take on the first pass, and a second pass fills
 * the remaining room in time order, so a slow news day still fills the card
 * rather than showing four headlines about one company.
 */
export function mergeNews(
  items: readonly NewsItem[],
  { limit, perSymbol }: { limit: number; perSymbol: number },
): NewsItem[] {
  return mergeBySymbol(items, {
    limit,
    perSymbol,
    keyOf: (item) => titleKey(item.title),
  });
}

/**
 * The two rules above, over anything that knows its listing and its time.
 * The X column wants the same breadth guarantee for the same reason: sorted
 * on time alone it is whatever NVIDIA and Strategy posted this morning.
 *
 * An item whose `keyOf` is empty is dropped, since a thing with no identity
 * cannot be told apart from the next one.
 */
export function mergeBySymbol<T extends { symbol: string; publishedAt: number }>(
  items: readonly T[],
  {
    limit,
    perSymbol,
    keyOf,
  }: { limit: number; perSymbol: number; keyOf: (item: T) => string },
): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  unique.sort((a, b) => b.publishedAt - a.publishedAt);

  const room = Math.max(limit, 0);
  const taken = new Set<T>();
  const counts = new Map<string, number>();
  const kept: T[] = [];
  for (const item of unique) {
    if (kept.length >= room) break;
    const count = counts.get(item.symbol) ?? 0;
    if (count >= perSymbol) continue;
    counts.set(item.symbol, count + 1);
    taken.add(item);
    kept.push(item);
  }
  for (const item of unique) {
    if (kept.length >= room) break;
    if (!taken.has(item)) kept.push(item);
  }
  return kept.sort((a, b) => b.publishedAt - a.publishedAt);
}

/**
 * How long ago, in the house voice: plain words, no abbreviations, no
 * clever relative phrasing. Anything older than a week is given as a date,
 * because "13 days ago" is arithmetic a reader should not have to do.
 */
export function formatTimeAgo(publishedAt: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - publishedAt) / 1000));
  if (seconds < 90) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours === 1) return "an hour ago";
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days <= 7) return `${days} days ago`;
  return new Date(publishedAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
