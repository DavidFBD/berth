import { publisherFromUrl } from "@/lib/news-fold";
import { MARKETAUX_ARTICLES_PER_CALL, marketauxKey } from "@/lib/news-schedule";
import type { IngestItem } from "@/lib/server/news-store";

/**
 * Marketaux's news API (api.marketaux.com/v1/news/all), asked by
 * lib/server/news-ingest unless `NEWS_MARKETAUX` is "off" (lib/news-schedule),
 * within its own daily and per-minute caps, four listings and twenty
 * articles a call (David's Basic plan).
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

/** One page as ingestion needs it: its items, and whether the window is covered. */
export type MarketauxPage = {
  items: IngestItem[];
  /** Articles in the window Marketaux says it has (meta.found). */
  found: number;
  /** Articles this page carried, kept or not. */
  returned: number;
  /** The oldest article's time on this page, epoch ms: the next page asks before it. */
  oldestAt?: number;
};

/** Seconds, UTC, as Marketaux reads a time ("2026-10-02T08:35:16"). */
const stamp = (epochMs: number) => new Date(epochMs).toISOString().slice(0, 19);

/**
 * One page for `symbols`, published after `sinceMs` and, paging back,
 * before `beforeMs`, newest first. Throws on a refusal (a 429, an outage)
 * or after five seconds, so a hung Marketaux costs a run little.
 */
export async function fetchMarketaux(
  symbols: readonly string[],
  sinceMs: number,
  {
    beforeMs,
    key = marketauxKey(),
    fetcher = fetch,
  }: { beforeMs?: number; key?: string; fetcher?: typeof fetch } = {},
): Promise<MarketauxPage> {
  if (!key) throw new Error("Marketaux key not set");
  const url = new URL(ENDPOINT);
  url.searchParams.set("symbols", symbols.join(","));
  url.searchParams.set("filter_entities", "true");
  url.searchParams.set("language", "en");
  url.searchParams.set("limit", String(MARKETAUX_ARTICLES_PER_CALL));
  url.searchParams.set("published_after", stamp(sinceMs));
  if (beforeMs !== undefined) url.searchParams.set("published_before", stamp(beforeMs));
  url.searchParams.set("api_token", key);
  const response = await fetcher(url, { cache: "no-store", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Marketaux answered ${response.status}`);
  const payload = (await response.json()) as { data?: Article[]; meta?: { found?: number; returned?: number } };
  const data = payload.data ?? [];
  const times = data.map((article) => (article.published_at ? Date.parse(article.published_at) : Number.NaN)).filter(Number.isFinite);
  return {
    items: marketauxItems(payload, symbols),
    found: Number(payload.meta?.found ?? data.length),
    returned: data.length,
    oldestAt: times.length > 0 ? Math.min(...times) : undefined,
  };
}

/** A run has 45 s for every source; a hung Marketaux must not take much of it. */
export const FETCH_TIMEOUT_MS = 5_000;
