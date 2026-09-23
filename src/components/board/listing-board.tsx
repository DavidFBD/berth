"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { CaretRight, Funnel } from "@phosphor-icons/react";
import { Sparkline } from "@/components/board/sparkline";
import { JevMark } from "@/components/jev-mark";
import { Button } from "@/components/ui/button";
import { Panel, SectionHeading } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { useCopy, useMoney } from "@/components/settings-provider";
import { useHubAccount } from "@/hooks/use-hub-account";
import { useHubHoldings } from "@/hooks/use-hub-holdings";
import { useListingPerformance } from "@/hooks/use-listing-performance";
import { useListingPrices } from "@/hooks/use-listing-prices";
import { useMoves } from "@/hooks/use-moves";
import { formatTokenAmount } from "@/lib/format";
import { STOCK_LISTINGS, type TokenListing } from "@/lib/listings";
import { EASE_LIFT, SPRING_POP } from "@/lib/motion";
import {
  changeDirection,
  formatPercentChange,
  percentChange,
  type ChangeDirection,
} from "@/lib/performance";

/** Text colour per direction, for the change figures. */
const CHANGE_TONE: Record<ChangeDirection, string> = {
  up: "text-good",
  down: "text-bad",
  flat: "text-muted-foreground",
};

/**
 * The board: every stock and fund listing, priced by the solver oracle, with
 * the shape of its last months, what it did over that window and over the
 * day, and what the account already holds of each. Tapping a row opens the
 * buy drawer; a held row also offers a sell; on a desktop, where the news
 * sits in its own column beside this one, a row also offers to point that
 * column at itself.
 *
 * Cash (SGOV) is not here; it has its own line, and a Treasury fund's price
 * barely moves, so the yield is the number that says something there.
 */
export function ListingBoard({
  onBuy,
  onSell,
  onFilterNews,
  newsFilterSymbol,
}: {
  onBuy: (listing: TokenListing) => void;
  onSell?: (listing: TokenListing) => void;
  /** Point the news column at this listing, or clear it if it is already there. */
  onFilterNews?: (listing: TokenListing) => void;
  /** Which listing the news column is showing, if any. */
  newsFilterSymbol?: string;
}) {
  const copy = useCopy();
  const moves = useMoves();
  const money = useMoney();
  const account = useHubAccount();
  const holdings = useHubHoldings(account.hubWallet);
  const prices = useListingPrices();
  const performance = useListingPerformance();
  // One row at a time, so twelve rows do not each carry their own state. A
  // focus counts as a hover: the filter must be reachable from the keyboard,
  // and a control that is invisible when focused is a trap.
  const [activeRow, setActiveRow] = useState<string | null>(null);

  const heldOf = (listing: TokenListing): bigint | undefined => {
    if (!holdings.settled) return undefined;
    return holdings.holdings.find(
      (holding) => holding.listing.address === listing.address,
    )?.balance;
  };

  return (
    <Panel surface="sheet">
      <SectionHeading
        title={copy.boardTitle}
        hint={copy.boardHint}
        note={
          performance.seriesDays > 0
            ? copy.boardPerformanceNote(performance.seriesDays)
            : undefined
        }
      />
      <ul className="divide-y divide-border border-t border-border">
        {STOCK_LISTINGS.map((listing) => {
          const price = prices.priceOf(listing);
          const held = heldOf(listing);
          const hasPosition = held !== undefined && held > 0n;
          const heldUsd = hasPosition
            ? prices.usdValue(listing, held)
            : undefined;
          const moved = performance.performanceOf(listing);
          const direction = changeDirection(moved?.changePct);
          const series = moved?.series;
          // The line carries its OWN window, not the day: an eighty day
          // climb drawn red because this morning dipped would contradict the
          // shape a person is looking at. The figure under it says the same
          // thing in digits, which is what fills a desktop row that would
          // otherwise be a name, a lot of air, and a price.
          const windowChange = series
            ? percentChange(series[0], series[series.length - 1])
            : undefined;
          const lineDirection = changeDirection(windowChange);
          const isFiltered = newsFilterSymbol === listing.symbol;
          const showFilter = activeRow === listing.symbol || isFiltered;
          const filterLabel = isFiltered
            ? copy.boardShowAllNews
            : copy.boardFilterNews(listing.name);
          return (
            // Siblings, never nested buttons: the row buys, the small buttons
            // filter and sell.
            <li
              key={listing.address}
              className={`flex items-stretch transition-colors duration-150 ${isFiltered ? "bg-muted/50" : ""}`}
              onMouseEnter={() => setActiveRow(listing.symbol)}
              onMouseLeave={() => setActiveRow(null)}
              onFocusCapture={() => setActiveRow(listing.symbol)}
              onBlurCapture={() => setActiveRow(null)}
            >
              {/*
                A grid, not a flex row. Every line and every price now starts
                at the same x down the whole board, which is the difference
                between a quote board and a list of cards: with flex, each
                row's line floated wherever its own company name ended.
              */}
              <button
                type="button"
                onClick={() => onBuy(listing)}
                className="grid min-h-14 min-w-0 flex-1 grid-cols-[minmax(0,1fr)_3rem_auto_0.75rem] items-center gap-3 px-4 py-2.5 text-left transition-[background-color,transform] duration-150 ease-lift hover:bg-muted/60 active:scale-[0.995] active:bg-muted lg:grid-cols-[minmax(0,1fr)_7rem_5.5rem_0.75rem]"
              >
                {/*
                  The name takes what it needs and the line takes the rest.
                  With the name on flex-1 a desktop row was a short name, two
                  hundred pixels of nothing, then a 48px line: the eye had to
                  cross the gap to connect a company to its own price.
                */}
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-semibold text-foreground">
                      {listing.name}
                    </span>
                    <span className="money text-xs text-muted-foreground">
                      {listing.symbol}
                    </span>
                  </div>
                  {/* Only when there is something to say. Twelve rows reading
                      "Stock" under twelve company names is a column of noise,
                      and the section is already called Stocks and funds. */}
                  {/* A move large for this listing, and the post Jev read as
                      related to it. Text only: the row is the buy button, and
                      the post itself is in the news column. */}
                  {moves.get(listing.symbol) && (
                    <div className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-muted-foreground">
                      <JevMark className="size-2.5" />
                      <span className="truncate">
                        {copy.moveInTheNews(moves.get(listing.symbol)!.post.name)}
                      </span>
                    </div>
                  )}
                  {hasPosition && (
                    <div className="money mt-0.5 truncate text-xs text-foreground/80">
                      {copy.boardYouHold(
                        heldUsd !== undefined
                          ? `${formatTokenAmount(held, listing.decimals, 6)} ${listing.symbol} ≈ ${money.format(heldUsd)}`
                          : `${formatTokenAmount(held, listing.decimals, 6)} ${listing.symbol}`,
                      )}
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-center gap-0.5">
                  {series && lineDirection && (
                    <>
                      <Sparkline
                        values={series}
                        direction={lineDirection}
                        className="h-[18px] w-full max-w-28"
                      />
                      {windowChange !== undefined && (
                        <span
                          className={`money text-[10px] tabular-nums ${CHANGE_TONE[lineDirection]}`}
                        >
                          {formatPercentChange(windowChange, 1)}
                        </span>
                      )}
                    </>
                  )}
                </div>
                <div className="text-right">
                  <div className="money text-sm tabular-nums text-foreground">
                    {price !== undefined ? (
                      money.format(price)
                    ) : prices.isLoading ? (
                      <Skeleton className="h-4 w-14" />
                    ) : (
                      <span className="text-muted-foreground">·</span>
                    )}
                  </div>
                  {moved?.changePct !== undefined && direction && (
                    <div
                      className={`money text-[11px] tabular-nums ${CHANGE_TONE[direction]}`}
                    >
                      {formatPercentChange(moved.changePct)}
                    </div>
                  )}
                </div>
                {/* The grid keeps this track whether or not a caret sits in
                    it, so a held row's price never shifts left of an unheld
                    row's. */}
                {!(hasPosition && onSell) && (
                  <CaretRight className="size-3 text-muted-foreground" />
                )}
              </button>

              {/*
                Desktop only, because only there does the news have a column
                of its own to point at. The slot is always in the layout and
                only its contents fade, so a row does not resize under the
                cursor that is about to click it.
              */}
              {onFilterNews && (
                <div className="hidden shrink-0 items-center pr-2 lg:flex">
                  <motion.button
                    type="button"
                    onClick={() => onFilterNews(listing)}
                    aria-label={filterLabel}
                    title={filterLabel}
                    aria-pressed={isFiltered}
                    initial={false}
                    animate={{ opacity: showFilter ? 1 : 0, x: showFilter ? 0 : 6 }}
                    transition={{ duration: 0.15, ease: EASE_LIFT }}
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.96 }}
                    style={{ pointerEvents: showFilter ? "auto" : "none" }}
                    className={`flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-medium ${
                      isFiltered
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Funnel
                      className="size-3"
                      weight={isFiltered ? "fill" : "regular"}
                    />
                    {copy.boardFilterNewsShort}
                  </motion.button>
                </div>
              )}

              {hasPosition && onSell && (
                <div className="flex shrink-0 items-center pr-3">
                  <motion.div whileTap={{ scale: 0.96 }} transition={SPRING_POP}>
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => onSell(listing)}
                    >
                      {copy.sell}
                    </Button>
                  </motion.div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
