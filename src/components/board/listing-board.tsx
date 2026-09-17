"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { CaretRight, Funnel } from "@phosphor-icons/react";
import { Sparkline } from "@/components/board/sparkline";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCopy, useMoney } from "@/components/settings-provider";
import { useHubAccount } from "@/hooks/use-hub-account";
import { useHubHoldings } from "@/hooks/use-hub-holdings";
import { useListingPerformance } from "@/hooks/use-listing-performance";
import { useListingPrices } from "@/hooks/use-listing-prices";
import { formatTokenAmount } from "@/lib/format";
import {
  STOCK_LISTINGS,
  type StockCategory,
  type TokenListing,
} from "@/lib/listings";
import { EASE_LIFT, SPRING_POP } from "@/lib/motion";
import {
  changeDirection,
  formatPercentChange,
  percentChange,
  type ChangeDirection,
} from "@/lib/performance";

/** Category, in plain words. Data, not voice. */
const CATEGORY_LABEL: Record<StockCategory, string> = {
  equity: "Stock",
  etf: "Fund",
  treasury: "Treasury",
};

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
    <section className="rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex flex-col gap-0.5 px-4 pt-3.5 pb-2.5">
        <span className="text-[11.5px] font-bold tracking-(--tracking-caps) uppercase text-muted-foreground">
          {copy.boardTitle}
        </span>
        <span className="text-xs text-muted-foreground">{copy.boardHint}</span>
        {performance.seriesDays > 0 && (
          <span className="text-[11.5px] text-muted-foreground">
            {copy.boardPerformanceNote(performance.seriesDays)}
          </span>
        )}
      </div>
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
              <button
                type="button"
                onClick={() => onBuy(listing)}
                className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left transition-[background-color,transform] duration-150 ease-lift hover:bg-muted/60 active:scale-[0.995] active:bg-muted"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-semibold text-foreground">
                      {listing.name}
                    </span>
                    <span className="money text-xs text-muted-foreground">
                      {listing.symbol}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{CATEGORY_LABEL[listing.category]}</span>
                    {hasPosition && (
                      <span className="money truncate text-foreground/80">
                        {copy.boardYouHold(
                          heldUsd !== undefined
                            ? `${formatTokenAmount(held, listing.decimals, 6)} ${listing.symbol} ≈ ${money.format(heldUsd)}`
                            : `${formatTokenAmount(held, listing.decimals, 6)} ${listing.symbol}`,
                        )}
                      </span>
                    )}
                  </div>
                </div>
                {series && lineDirection && (
                  <div className="flex shrink-0 flex-col items-center gap-0.5">
                    <Sparkline
                      values={series}
                      direction={lineDirection}
                      className="h-[18px] w-12 lg:w-24 xl:w-28"
                    />
                    {windowChange !== undefined && (
                      <span
                        className={`money text-[10px] tabular-nums ${CHANGE_TONE[lineDirection]}`}
                      >
                        {formatPercentChange(windowChange, 1)}
                      </span>
                    )}
                  </div>
                )}
                <div className="shrink-0 text-right">
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
                {!(hasPosition && onSell) && (
                  <CaretRight className="size-4 shrink-0 text-muted-foreground" />
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
    </section>
  );
}
