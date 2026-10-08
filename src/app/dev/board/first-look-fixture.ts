import { TOKEN_LISTINGS } from "@/lib/listings";
import type { StoryCard } from "@/lib/news-stories";

/**
 * Dev galleries only: the drawer's card a first look attaches to its news
 * line (lib/first-look), so a fixture never claims news it cannot show.
 */
export function fixtureStory(symbol: string, title: string, hoursAgo: number, publisher = "Reuters"): StoryCard {
  return {
    id: `s-fixture-${symbol}`,
    storyId: -symbol.charCodeAt(0),
    kind: "article",
    title,
    url: "https://www.nasdaq.com/",
    publisher,
    publishedAt: Date.now() - hoursAgo * 60 * 60 * 1000,
    symbol,
    name: TOKEN_LISTINGS.find((listing) => listing.symbol === symbol)?.name ?? symbol,
    symbols: [symbol],
    verdict: "fact",
    about: 0.93,
    readings: { [symbol]: { verdict: "fact", about: 0.93 } },
    alsoReportedBy: [],
    alsoOnX: [],
  };
}

export const FIXTURE_STORIES = {
  NVDA: () => fixtureStory("NVDA", "Nvidia agrees to supply chips for a new OpenAI data centre", 2),
  AAPL: () => fixtureStory("AAPL", "Apple partners with LG on doorbells, locks and thermostats", 30, "MarketWatch"),
};
