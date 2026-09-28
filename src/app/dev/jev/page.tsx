"use client";

import { Suspense, useEffect, useState } from "react";
import { notFound, useSearchParams } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NewsFeed } from "@/components/board";
import { Skeleton } from "@/components/ui/skeleton";
import type { ListingXResponse } from "@/app/api/listing-x/route";

/**
 * Dev-only: the news column's posts tab from a fixture, so the "Live
 * curation by Jev" line can be looked at without spending X or Jev credit.
 * Not linked anywhere; 404 in prod.
 *
 *   /dev/jev                   settled: Jev's still mark
 *   /dev/jev?state=refreshing  a refresh in flight that never lands: the orb
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
    },
  ],
  reserve: [],
  curation: { seen: 412, accounts: 96, read: 58, kept: 12 },
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
  const refreshing = useSearchParams().get("state") === "refreshing";
  const [client] = useState(() => {
    const seeded = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seeded.setQueryData(["listings", "x", "all"], FIXTURE);
    // News and performance stay empty and settled; only the posts matter here.
    seeded.setQueryData(["listings", "news", "all"], []);
    return seeded;
  });
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
