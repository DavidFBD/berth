import { firstLookSymbols, judgeRecent, type FirstLook, type FirstLookResponse, windowStart } from "@/lib/first-look";
import { isNotableMove } from "@/lib/moves";
import type { NewsItem } from "@/lib/news";
import { forListing, type StoryCard } from "@/lib/news-stories";
import { jevConfigured, withCachedVerdictsOnly } from "@/lib/server/jev";
import { loadPerformance } from "@/lib/server/listing-performance";
import { readCards } from "@/lib/server/news-read";

/**
 * The first look for the first buy's examples, and one more stock when the
 * first stock card asks (lib/first-look).
 *
 * Inside `withCachedVerdictsOnly`: it reads only the verdicts the news column
 * already paid for and never asks Jev anything, however many newcomers open
 * it. A headline nobody has judged yet never passes, so it makes no line.
 * The move comes from the marks alone.
 * Never throws; a failure is no look.
 */
export async function loadFirstLook({ also, now = Date.now() }: { also?: string | null; now?: number } = {}): Promise<FirstLookResponse> {
  if (!jevConfigured()) return { judged: false, asOf: now, looks: {} };
  return withCachedVerdictsOnly(() => gather(firstLookSymbols(also), now));
}

/** A headline in the window, with the drawer's own card for it (the one the look attaches). */
type WindowItem = NewsItem & { card: StoryCard };

/**
 * Every headline the store holds for each listing in the window, newest
 * first. Read whole, once, for all of them: the listing feed's own cap
 * (eight a listing, lib/server/listing-news) would hide a Friday story
 * behind a weekend of opinion pieces.
 */
async function readWindow(
  symbols: readonly string[],
  now: number,
): Promise<{ items: Map<string, WindowItem[]> } | undefined> {
  try {
    const { cards } = await readCards({ sinceMs: windowStart(now) });
    const items = new Map<string, WindowItem[]>(symbols.map((symbol) => [symbol, []]));
    for (const card of cards) {
      if (card.kind !== "article") continue;
      for (const symbol of symbols) {
        // Each listing's headline carries its own reading, or none while Jev has not judged it (lib/news-stories).
        const mine = forListing(card, symbol);
        if (!mine) continue;
        const item: WindowItem = { title: mine.title, url: mine.url, publishedAt: mine.publishedAt, source: mine.publisher, symbol, name: mine.name, card: mine };
        if (mine.verdict) item.verdict = mine.verdict;
        if (mine.about !== undefined) item.about = mine.about;
        items.get(symbol)!.push(item);
      }
    }
    return { items };
  } catch (error) {
    console.warn("[first-look]", error instanceof Error ? error.message : error);
    return undefined;
  }
}

async function gather(symbols: string[], now: number): Promise<FirstLookResponse> {
  const [news, performance] = await Promise.all([readWindow(symbols, now), loadPerformance().catch(() => undefined)]);
  const looks: Record<string, FirstLook> = {};
  for (const symbol of symbols) {
    // A store that could not be read was not read: no look at all.
    if (!news) break;
    const { lead, ...said } = judgeRecent({ symbol, items: news.items.get(symbol) ?? [], now });
    // The headline the news line stands on, as the drawer shows it (lib/first-look newsOf).
    const recent: FirstLook = lead ? { ...said, story: lead.card } : said;
    const entry = performance?.performance[symbol];
    const movePct =
      entry && isNotableMove(entry.series ?? [], entry.changePct) ? Math.round(entry.changePct! * 10) / 10 : undefined;
    looks[symbol] = movePct === undefined ? recent : { ...recent, movePct };
  }
  return { judged: true, asOf: now, looks };
}
