"use client";

import { Suspense, useState } from "react";
import { notFound, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { NewsFeed } from "@/components/board";
import { newsQueryKey, type NewsData } from "@/hooks/use-news";
import type { StoryCard } from "@/lib/news-stories";

/**
 * Dev-only: the news column from fixtures, so its sections can be reviewed
 * (and shot) without a session or a store. Not linked anywhere; 404 in prod.
 *
 *   /dev/news                 a holder of NVIDIA, Apple and Strategy: owner
 *                             news, a filing, and the river
 *   /dev/news?scene=quiet     the same holder on a day Jev found nothing
 *   /dev/news?scene=unjudged  before Jev has read anything about them
 *   /dev/news?scene=none      someone who owns nothing: the river only
 *   /dev/news?scene=failed    the store could not be read
 */
export default function NewsGalleryPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-6">
      <Suspense fallback={null}>
        <Gallery />
      </Suspense>
    </div>
  );
}

const HOUR = 60 * 60 * 1000;
const AVATAR = "https://pbs.twimg.com/profile_images/1593304942210478080/TUYae5z7_normal.jpg";

function article(id: number, symbol: string, name: string, title: string, publisher: string, hoursAgo: number, extra: Partial<StoryCard> = {}): StoryCard {
  return {
    id: `s${id}`,
    storyId: id,
    kind: "article",
    title,
    url: `https://example.com/story/${id}`,
    publisher,
    publishedAt: Date.now() - hoursAgo * HOUR,
    symbol,
    name,
    symbols: [symbol],
    verdict: "fact",
    about: 0.9,
    substance: 3,
    alsoReportedBy: [],
    alsoOnX: [],
    ...extra,
    readings: { [symbol]: { verdict: extra.verdict ?? "fact", about: 0.9, substance: extra.substance ?? 3 } },
  };
}

function fixture(scene: string): NewsData {
  const now = Date.now();
  if (scene === "failed") return { stories: [], reserve: [], owned: [], read: {}, events: [], reason: "store unavailable", failed: true };
  const nvidiaEarnings = article(1, "NVDA", "NVIDIA", "NVIDIA Agrees to Supply Chips for a New Data Center in Texas", "Reuters", 3, {
    verdict: "material",
    substance: 3.8,
    alsoReportedBy: [
      { publisher: "CNBC", url: "https://example.com/cnbc" },
      { publisher: "The Motley Fool", url: "https://example.com/fool" },
      { publisher: "Zacks", url: "https://example.com/zacks" },
    ],
    alsoOnX: [{ name: "Reuters Business", username: "ReutersBiz", url: "https://x.com/ReutersBiz/status/1" }],
  });
  const appleFact = article(2, "AAPL", "Apple", "Apple Opens Its Largest Store in India", "Bloomberg", 9);
  const post: StoryCard = {
    id: "1974000000000000000",
    storyId: 3,
    kind: "post",
    title: "Tesla delivered 497,099 vehicles in the third quarter, a record.",
    url: "https://x.com/Tesla/status/1974000000000000000",
    publisher: "Tesla",
    publishedAt: now - 5 * HOUR,
    symbol: "TSLA",
    name: "Tesla",
    symbols: ["TSLA"],
    verdict: "material",
    substance: 3.9,
    readings: { TSLA: { verdict: "material", substance: 3.9 } },
    post: { author: { name: "Tesla", username: "Tesla", avatarUrl: AVATAR }, likes: 41_200, retweets: 5_100, quotes: 900, replies: 3_300 },
    alsoReportedBy: [{ publisher: "Reuters", url: "https://example.com/reuters-tesla" }],
    alsoOnX: [{ name: "Walter Bloomberg", username: "DeItaone", url: "https://x.com/DeItaone/status/2" }],
  };
  const river = [
    post,
    article(4, "SPY", "S&P 500 ETF", "Stocks Close at a Record as Treasury Yields Ease", "The Wall Street Journal", 6),
    article(5, "MU", "Micron", "Micron Raises Its Outlook on Memory Demand From AI Servers", "CNBC", 11, {
      alsoReportedBy: [{ publisher: "Barron's", url: "https://example.com/barrons" }],
    }),
    article(6, "GME", "GameStop", "GameStop Reports a Second Quarter Profit", "Zacks", 20, { verdict: "analysis", substance: 2.3 }),
  ];
  const quiet = scene === "quiet" || scene === "unjudged";
  return {
    stories: quiet ? river : [nvidiaEarnings, appleFact, ...river],
    reserve: [],
    owned: quiet ? [] : [nvidiaEarnings, appleFact],
    // On the quiet day Jev read NVIDIA and Apple, and nothing about Strategy yet.
    read: scene === "unjudged" ? {} : scene === "quiet" ? { NVDA: 6, AAPL: 4, TSLA: 3 } : { NVDA: 6, AAPL: 4, MSTR: 2, TSLA: 3 },
    events: [
      {
        symbol: "MSTR",
        name: "Strategy",
        kind: "filing",
        day: new Date(now - 2 * 24 * HOUR).toISOString().slice(0, 10),
        form: "8-K",
        report: "report",
        url: "https://www.sec.gov/Archives/edgar/data/1050446/000119312526409863/mstr-20260930.htm",
      },
    ],
    judged: scene === "unjudged" ? undefined : { read: 214, kept: 31 },
    updatedAt: now - 20 * 60 * 1000,
  };
}

function Gallery() {
  const scene = useSearchParams().get("scene") ?? "owned";
  const client = useQueryClient();
  // Seeded before the column mounts, so it reads the fixture and not the route.
  useState(() => client.setQueryData(newsQueryKey(), fixture(scene)));
  return <NewsFeed held={scene === "none" ? undefined : ["NVDA", "AAPL", "MSTR"]} />;
}
