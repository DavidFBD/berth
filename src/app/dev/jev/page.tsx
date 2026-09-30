"use client";

import { Suspense, useEffect, useState } from "react";
import { notFound, useSearchParams } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NewsFeed } from "@/components/board";
import { Skeleton } from "@/components/ui/skeleton";
import type { ListingXResponse } from "@/app/api/listing-x/route";
import type { ListingNewsResponse } from "@/app/api/listing-news/route";

/**
 * Dev-only: the news column's posts tab from a fixture, so the "Live
 * curation by Jev" line can be looked at without spending X or Jev credit.
 * Not linked anywhere; 404 in prod.
 *
 *   /dev/jev                   settled: Jev's still mark, "Updated 3 minutes ago"
 *   /dev/jev?state=refreshing  a background fetch that never lands: the orb by Jev
 *   /dev/jev?state=pressed     the refresh button pressed, never landing: its orb
 *
 * The first post carries Jev's reading and two desks' copies of the same
 * story folded into it (lib/story-groups); tap Headlines for their readings
 * and the headlines' own credit in the (i).
 */

const FIXTURE: ListingXResponse = {
  items: [
    {
      id: "1",
      text: "NVIDIA announces a new supply agreement for its next data centre systems.",
      publishedAt: Date.now() - 42 * 60_000,
      author: { name: "NVIDIA Newsroom", username: "nvidianewsroom", avatarUrl: "" },
      url: "https://x.com/nvidianewsroom",
      likes: 1200,
      retweets: 210,
      quotes: 40,
      replies: 88,
      symbol: "NVDA",
      name: "NVIDIA",
      verdict: "material",
      alsoBy: [
        { name: "First Squawk", username: "FirstSquawk", url: "https://x.com/FirstSquawk" },
        { name: "financialjuice", username: "financialjuice", url: "https://x.com/financialjuice" },
      ],
    },
    {
      id: "2",
      text: "Tesla shares fall after the quarter's delivery numbers came in under estimates.",
      publishedAt: Date.now() - 3 * 3_600_000,
      author: { name: "Reuters", username: "Reuters", avatarUrl: "" },
      url: "https://x.com/Reuters",
      likes: 640,
      retweets: 150,
      quotes: 22,
      replies: 61,
      symbol: "TSLA",
      name: "Tesla",
      verdict: "fact",
    },
  ],
  reserve: [],
  curation: { seen: 412, accounts: 96, read: 58, kept: 12 },
  updatedAt: Date.now() - 3 * 60_000,
};

const HEADLINES: ListingNewsResponse = {
  items: [
    {
      title: "Micron Earnings: Watch These Key Metrics",
      url: "https://www.nasdaq.com/",
      publishedAt: Date.now() - 2 * 3_600_000,
      source: "Zacks",
      symbol: "MU",
      name: "Micron",
      verdict: "analysis",
    },
    {
      title: "Tesla Secures $30 Billion in New Credit Facilities",
      url: "https://www.nasdaq.com/",
      publishedAt: Date.now() - 5 * 3_600_000,
      source: "Barchart",
      symbol: "TSLA",
      name: "Tesla",
      verdict: "material",
    },
  ],
  updatedAt: Date.now() - 4 * 60_000,
  judged: { read: 182, kept: 71 },
};

export default function JevGalleryPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <Suspense fallback={<Skeleton className="m-4 h-40" />}>
      <Gallery />
    </Suspense>
  );
}

function Gallery() {
  const state = useSearchParams().get("state");
  const refreshing = state === "refreshing";
  const pressed = state === "pressed";
  const [client] = useState(() => {
    const seeded = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seeded.setQueryData(["listings", "x", "all"], FIXTURE);
    seeded.setQueryData(["listings", "news", "all"], HEADLINES);
    return seeded;
  });
  useEffect(() => {
    if (!pressed) return;
    // The button's own fetch, held open so the orb can be looked at without
    // spending a call on X. Dev only, and only on this page.
    const real = window.fetch;
    window.fetch = (input, init) =>
      String(input instanceof Request ? input.url : input).includes("/api/listing-")
        ? new Promise<Response>(() => {})
        : real(input, init);
    const timer = window.setTimeout(() => {
      document.querySelector<HTMLButtonElement>("[data-news-refresh]")?.click();
    }, 300);
    return () => {
      window.clearTimeout(timer);
      window.fetch = real;
    };
  }, [pressed]);
  useEffect(() => {
    if (!refreshing) return;
    void client.fetchQuery({ queryKey: ["listings", "x", "all"], queryFn: () => new Promise<ListingXResponse>(() => {}), staleTime: 0 });
  }, [client, refreshing]);
  return (
    <QueryClientProvider client={client}>
      <style>{`[data-wallet-diagnostics], nextjs-portal { display: none !important; }`}</style>
      <div className="mx-auto w-full max-w-md px-4 py-6">
        <NewsFeed />
      </div>
    </QueryClientProvider>
  );
}
