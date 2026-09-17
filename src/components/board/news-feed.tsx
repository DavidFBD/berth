"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, X } from "@phosphor-icons/react";
import { Skeleton } from "@/components/ui/skeleton";
import { useCopy } from "@/components/settings-provider";
import { useListingNews } from "@/hooks/use-listing-news";
import { useListingPerformance } from "@/hooks/use-listing-performance";
import { TOKEN_LISTINGS, type TokenListing } from "@/lib/listings";
import { EASE_LIFT } from "@/lib/motion";
import { formatTimeAgo } from "@/lib/news";
import {
  changeDirection,
  formatPercentChange,
  type ChangeDirection,
} from "@/lib/performance";

/** Text colour per direction, matching the board's. */
const TONE: Record<ChangeDirection, string> = {
  up: "text-good",
  down: "text-bad",
  flat: "text-muted-foreground",
};

const LISTING_BY_SYMBOL = new Map(
  TOKEN_LISTINGS.map((listing) => [listing.symbol, listing]),
);

/** The river settles one card after another rather than all at once. */
const LIST = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.03 } },
  gone: { opacity: 0, transition: { duration: 0.12 } },
};
const CARD = {
  hidden: { opacity: 0, y: 8 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.22, ease: EASE_LIFT } },
};

/**
 * What is being written about the listings, newest first.
 *
 * Headline, who published it and when, and a link out to them. Never the
 * article itself: the words belong to whoever wrote them, and a reader
 * deciding what to buy is better served by the publisher's page than by our
 * summary of it. Every card leaves the app, which the arrow says.
 *
 * `filter` narrows the river to one listing, which the board sets from a row
 * on a desktop. The whole list is keyed on it, so changing the filter plays
 * as one swap rather than twelve independent ones.
 *
 * On the tile instead of a photograph: the feed carries no images. Nasdaq
 * serves none in the document, and every article page on it answers with the
 * same generic 2019 stock photograph, verified across fourteen articles from
 * four publishers. Twelve cards wearing one recycled picture would be worse
 * than none, so the slot holds the thing we actually know and a reader
 * actually wants: which listing the story is about, and what that listing
 * did today. A licensed wire that carries real per-article images (Marketaux
 * serves an `image_url`) can take this slot whenever that call is made.
 *
 * Silence is not failure. A quiet hour, a stale feed and a blocked request
 * all end here as the same calm line, because none of them is something a
 * reader can act on.
 */
export function NewsFeed({
  filter,
  onClearFilter,
}: {
  filter?: TokenListing | null;
  onClearFilter?: () => void;
}) {
  const copy = useCopy();
  const news = useListingNews(filter?.symbol);
  const performance = useListingPerformance();

  return (
    <section className="rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex flex-col gap-0.5 px-4 pt-3.5 pb-2.5">
        <span className="text-[11.5px] font-bold tracking-(--tracking-caps) uppercase text-muted-foreground">
          {copy.newsTitle}
        </span>
        <span className="text-xs text-muted-foreground">{copy.newsHint}</span>

        <AnimatePresence initial={false}>
          {filter && (
            <motion.div
              key={filter.symbol}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18, ease: EASE_LIFT }}
              className="mt-1.5 flex items-center gap-2"
            >
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground">
                {copy.newsFilteredTo(filter.name)}
              </span>
              {onClearFilter && (
                <motion.button
                  type="button"
                  onClick={onClearFilter}
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.96 }}
                  className="flex items-center gap-0.5 text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                >
                  <X className="size-3" />
                  {copy.newsShowAll}
                </motion.button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {news.isLoading ? (
        <ul className="divide-y divide-border border-t border-border">
          {[0, 1, 2].map((row) => (
            <li key={row} className="flex items-start gap-3 px-4 py-3">
              <Skeleton className="size-11 shrink-0 rounded-lg" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-11/12" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </li>
          ))}
        </ul>
      ) : news.items.length === 0 ? (
        <p className="border-t border-border px-4 py-4 text-sm text-muted-foreground">
          {filter ? copy.newsEmptyFor(filter.name) : copy.newsEmpty}
        </p>
      ) : (
        <AnimatePresence mode="wait" initial={false}>
          <motion.ul
            key={filter?.symbol ?? "all"}
            variants={LIST}
            initial="hidden"
            animate="shown"
            exit="gone"
            className="divide-y divide-border border-t border-border"
          >
            {news.items.map((item) => {
              const listing = LISTING_BY_SYMBOL.get(item.symbol);
              const moved = listing
                ? performance.performanceOf(listing)
                : undefined;
              const direction = changeDirection(moved?.changePct);
              return (
                <motion.li key={item.url} variants={CARD}>
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start gap-3 px-4 py-3 transition-[background-color] duration-150 ease-lift hover:bg-muted/60"
                  >
                    {/* The ticker, in the face the app reserves for numbers,
                        tinted by how the listing moved. It says at a glance
                        which of twelve stories is about the thing you hold. */}
                    <span
                      aria-hidden="true"
                      className="money flex size-11 shrink-0 flex-col items-center justify-center rounded-lg bg-muted text-[10.5px] leading-none font-semibold tracking-tight"
                    >
                      <span className="text-foreground/80">{item.symbol}</span>
                      {moved?.changePct !== undefined && direction && (
                        <span
                          className={`mt-0.5 text-[8.5px] ${TONE[direction]}`}
                        >
                          {formatPercentChange(moved.changePct, 1)}
                        </span>
                      )}
                    </span>

                    <div className="min-w-0 flex-1">
                      {/* Two lines, then it stops: a river of headlines is
                          for scanning, and the publisher's page has the rest. */}
                      <p className="line-clamp-2 text-sm leading-snug font-medium text-foreground">
                        {item.title}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        <span className="text-foreground/70">{item.name}</span>
                        {/* Punctuation, not copy: the separator belongs to
                            the layout, the words on either side to lib/copy. */}
                        <span aria-hidden="true"> · </span>
                        {copy.newsByline(
                          item.source,
                          formatTimeAgo(item.publishedAt),
                        )}
                      </p>
                    </div>
                    <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  </a>
                </motion.li>
              );
            })}
          </motion.ul>
        </AnimatePresence>
      )}
    </section>
  );
}
