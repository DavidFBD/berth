import { firstLookSymbols, judgeToday, type FirstLook, type FirstLookResponse } from "@/lib/first-look";
import { isNotableMove } from "@/lib/moves";
import { jevConfigured, withCachedVerdictsOnly } from "@/lib/server/jev";
import { loadListingNews } from "@/lib/server/listing-news";
import { loadPerformance } from "@/lib/server/listing-performance";

/**
 * The first look for the first buy's examples, and one more stock when the
 * first stock card asks (lib/first-look).
 *
 * Inside `withCachedVerdictsOnly`: it reads only the verdicts the news column
 * already paid for and never asks Jev anything, however many newcomers open
 * it. A headline nobody has judged yet means Jev did not look, and then the
 * look says nothing about the news. The move comes from the marks alone.
 * Never throws; a failure is no look.
 */
export async function loadFirstLook({ also, now = Date.now() }: { also?: string | null; now?: number } = {}): Promise<FirstLookResponse> {
  if (!jevConfigured()) return { judged: false, asOf: now, looks: {} };
  return withCachedVerdictsOnly(() => gather(firstLookSymbols(also), now));
}

async function gather(symbols: string[], now: number): Promise<FirstLookResponse> {
  const [news, performance] = await Promise.all([
    Promise.all(symbols.map((symbol) => loadListingNews(symbol).catch(() => undefined))),
    loadPerformance().catch(() => undefined),
  ]);
  const looks: Record<string, FirstLook> = {};
  symbols.forEach((symbol, index) => {
    const response = news[index];
    // A feed that failed was not read: no look for it at all.
    if (!response || response.reason) return;
    const today = judgeToday({ symbol, items: response.items, read: response.judged?.read ?? 0, now });
    const entry = performance?.performance[symbol];
    const movePct =
      entry && isNotableMove(entry.series ?? [], entry.changePct) ? Math.round(entry.changePct! * 10) / 10 : undefined;
    looks[symbol] = movePct === undefined ? today : { ...today, movePct };
  });
  return { judged: true, asOf: now, looks };
}
