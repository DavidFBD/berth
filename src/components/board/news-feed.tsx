"use client";

import { ArrowUpRight } from "@phosphor-icons/react";
import { Skeleton } from "@/components/ui/skeleton";
import { useCopy } from "@/components/settings-provider";
import { useListingNews } from "@/hooks/use-listing-news";
import { formatTimeAgo } from "@/lib/news";

/**
 * What is being written about the listings, newest first.
 *
 * Headline, who published it and when, and a link out to them. Never the
 * article itself: the words belong to whoever wrote them, and a reader
 * deciding what to buy is better served by the publisher's page than by our
 * summary of it. Every card leaves the app, which the arrow says.
 *
 * Silence is not failure. A quiet hour, a stale feed and a blocked request
 * all end here as the same calm line, because none of them is something a
 * reader can act on.
 */
export function NewsFeed({ symbol }: { symbol?: string }) {
  const copy = useCopy();
  const news = useListingNews(symbol);

  return (
    <section className="rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex flex-col gap-0.5 px-4 pt-3.5 pb-2.5">
        <span className="text-[11.5px] font-bold tracking-(--tracking-caps) uppercase text-muted-foreground">
          {copy.newsTitle}
        </span>
        <span className="text-xs text-muted-foreground">{copy.newsHint}</span>
      </div>

      {news.isLoading ? (
        <ul className="divide-y divide-border border-t border-border">
          {[0, 1, 2].map((row) => (
            <li key={row} className="flex flex-col gap-2 px-4 py-3">
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-3 w-1/2" />
            </li>
          ))}
        </ul>
      ) : news.items.length === 0 ? (
        <p className="border-t border-border px-4 py-4 text-sm text-muted-foreground">
          {copy.newsEmpty}
        </p>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {news.items.map((item) => (
            <li key={item.url}>
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-3 px-4 py-3 transition-[background-color] duration-150 ease-lift hover:bg-muted/60"
              >
                <div className="min-w-0 flex-1">
                  {/* Two lines, then it stops: a river of headlines is for
                      scanning, and the publisher's page has the rest. */}
                  <p className="line-clamp-2 text-sm leading-snug font-medium text-foreground">
                    {item.title}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    <span className="text-foreground/70">{item.name}</span>
                    {/* Punctuation, not copy: the separator belongs to the
                        layout, the words on either side belong to lib/copy. */}
                    <span aria-hidden="true"> · </span>
                    {copy.newsByline(item.source, formatTimeAgo(item.publishedAt))}
                  </p>
                </div>
                <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
