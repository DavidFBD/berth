import { publisherFromUrl } from "@/lib/news-fold";
import type { IngestItem } from "@/lib/server/news-store";

/**
 * Marketaux's news API (api.marketaux.com/v1/news/all), asked only when
 * `NEWS_MARKETAUX` is "staff" or "everyone" (lib/news-schedule), within its
 * own daily request cap, a few listings a call because its free plan
 * answers three articles a request.
 *
 * Kept: the title, the link, the publisher (from the link's host, since the
 * API gives a domain), the time and which of our listings it tags with its
 * match score. Never its description, snippet, image, keywords, similar
 * items or sentiment score: the first four are the publisher's words and
 * pictures, the last is a reading Berth does not show.
 */

const ENDPOINT = "https://api.marketaux.com/v1/news/all";

type Article = {
  uuid?: string;
  title?: string;
  url?: string;
  source?: string;
  published_at?: string;
  language?: string;
  entities?: { symbol?: string; match_score?: number }[];
};

/** How surely Marketaux must tag an article to a listing before it is filed under it. */
export const MATCH_FLOOR = 10;

/** The articles in a response as store items, tagged only to `wanted`. Pure. */
export function marketauxItems(payload: { data?: Article[] }, wanted: readonly string[]): IngestItem[] {
  const items: IngestItem[] = [];
  for (const article of payload.data ?? []) {
    const publishedAt = article.published_at ? Date.parse(article.published_at) : Number.NaN;
    if (!article.uuid || !article.title || !article.url || !/^https?:\/\//i.test(article.url) || !Number.isFinite(publishedAt)) continue;
    if (article.language && article.language !== "en") continue;
    const symbols = [
      ...new Set(
        (article.entities ?? [])
          .filter((entity) => entity.symbol && wanted.includes(entity.symbol) && (entity.match_score ?? 0) >= MATCH_FLOOR)
          .map((entity) => entity.symbol as string),
      ),
    ];
    if (symbols.length === 0) continue;
    items.push({
      source: "marketaux",
      sourceId: article.uuid,
      title: article.title.trim(),
      url: article.url,
      publisher: publisherFromUrl(article.url, article.source),
      publishedAt,
      symbols,
      taggedBy: "feed",
    });
  }
  return items;
}

/** One request for `symbols`, published after `sinceMs`. Throws on a refusal. */
export async function fetchMarketaux(
  symbols: readonly string[],
  sinceMs: number,
  { key = process.env.MARKETAU_API_KEY, fetcher = fetch }: { key?: string; fetcher?: typeof fetch } = {},
): Promise<IngestItem[]> {
  if (!key) throw new Error("MARKETAU_API_KEY not set");
  const url = new URL(ENDPOINT);
  url.searchParams.set("symbols", symbols.join(","));
  url.searchParams.set("filter_entities", "true");
  url.searchParams.set("language", "en");
  url.searchParams.set("published_after", new Date(sinceMs).toISOString().slice(0, 16));
  url.searchParams.set("api_token", key);
  const response = await fetcher(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Marketaux answered ${response.status}`);
  return marketauxItems((await response.json()) as { data?: Article[] }, symbols);
}
