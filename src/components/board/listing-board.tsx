"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { Funnel } from "@phosphor-icons/react";
import { Sparkline } from "@/components/board/sparkline";
import { DisclosureRow, useDisclosure } from "@/components/board/disclosure";
import { TickerTile } from "@/components/board/holdings-list";
import { JevMark } from "@/components/jev-mark";
import { Button, buttonVariants } from "@/components/ui/button";
import { Panel, SectionHeading } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { useCopy, useMoney } from "@/components/settings-provider";
import { useHubAccount } from "@/hooks/use-hub-account";
import { useHubHoldings } from "@/hooks/use-hub-holdings";
import { useListingPerformance } from "@/hooks/use-listing-performance";
import { useListingPrices } from "@/hooks/use-listing-prices";
import { useMoves } from "@/hooks/use-moves";
import { STOCK_LISTINGS, rowName, type TokenListing } from "@/lib/listings";
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
 * Short by default: what the account holds, then the three listings moving
 * most today, and every other one behind "All". `held` stands in for the
 * account's balances, by listing address, for the dev gallery.
 *
 * Cash (SGOV) is not here; it has its own line, and a Treasury fund's price
 * barely moves, so the yield is the number that says something there.
 */
export function ListingBoard({
  onBuy,
  onSell,
  onFilterNews,
  newsFilterSymbol,
  held: heldOverride,
  expandAll = false,
}: {
  onBuy: (listing: TokenListing) => void;
  onSell?: (listing: TokenListing) => void;
  /** Point the news column at this listing, or clear it if it is already there. */
  onFilterNews?: (listing: TokenListing) => void;
  /** Which listing the news column is showing, if any. */
  newsFilterSymbol?: string;
  held?: ReadonlyMap<string, bigint>;
  /** Every listing at once, with no "All" disclosure: the board as its own sheet. */
  expandAll?: boolean;
}) {
  const copy = useCopy();
  const moves = useMoves();
  const money = useMoney();
  const account = useHubAccount();
  const holdings = useHubHoldings(account.hubWallets);
  const prices = useListingPrices();
  const performance = useListingPerformance();
  // One row at a time, so twelve rows do not each carry their own state. A
  // focus counts as a hover: the filter must be reachable from the keyboard,
  // and a control that is invisible when focused is a trap.
  const [activeRow, setActiveRow] = useState<string | null>(null);

  const [storedOpen, toggle, listId] = useDisclosure("board");
  // Opened as a sheet of its own (the home's board drawer), every listing
  // shows at once: the way there already said "every stock and fund".
  const open = expandAll || storedOpen;

  const heldOf = (listing: TokenListing): bigint | undefined => {
    if (heldOverride) return heldOverride.get(listing.address);
    if (!holdings.settled) return undefined;
    return holdings.holdings.find(
      (holding) => holding.listing.address === listing.address,
    )?.balance;
  };

  // Yours first, then the three moving most today, by the size of the
  // day's move either way; the rest keep the registry's order behind All.
  const yours = STOCK_LISTINGS.filter((listing) => (heldOf(listing) ?? 0n) > 0n);
  const dayMove = (listing: TokenListing) => Math.abs(performance.performanceOf(listing)?.changePct ?? 0);
  const movers = STOCK_LISTINGS.filter((listing) => !yours.includes(listing))
    .map((listing, index) => ({ listing, index }))
    .sort((a, b) => dayMove(b.listing) - dayMove(a.listing) || a.index - b.index)
    .slice(0, MOVERS_SHOWN)
    .map(({ listing }) => listing);
  const rest = STOCK_LISTINGS.filter((listing) => !yours.includes(listing) && !movers.includes(listing));
  const ranked = STOCK_LISTINGS.some((listing) => performance.performanceOf(listing)?.changePct !== undefined);

  const row = (listing: TokenListing) => {
    const price = prices.priceOf(listing);
    const held = heldOf(listing);
    const hasPosition = held !== undefined && held > 0n;
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
        className={`relative flex items-stretch transition-colors duration-150 ${isFiltered ? "bg-muted/50" : ""}`}
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
        <div className="relative flex min-w-0 flex-1">
        <button
          type="button"
          onClick={() => onBuy(listing)}
          // The richer five-column layout (a 7rem line, a 5.5rem price)
          // only ever fits past `@lg` of THIS row's own container: a board
          // embedded at its full width clears that easily, but the very
          // same row rendered inside a drawer (24rem on a desktop, capped
          // narrower still on a phone) never does and stays on the compact
          // template below. Below `@lg` the reserve column is held at the
          // same 3.5rem width the wide template also uses, so Sell (which
          // replaces the badge below) always lands in that same place.
          className="grid min-h-14 min-w-0 flex-1 grid-cols-[2.25rem_minmax(0,1fr)_3rem_auto_3.5rem] items-center gap-2.5 px-[18px] @lg/row:px-6 @lg/row:gap-3 py-2.5 text-left transition-[background-color,transform] duration-150 ease-lift hover:bg-muted/60 active:scale-[0.995] active:bg-muted @lg/row:grid-cols-[2.25rem_minmax(0,1fr)_7rem_5.5rem_3.5rem]"
        >
          {/*
            The name takes what it needs and the line takes the rest.
            With the name on flex-1 a desktop row was a short name, two
            hundred pixels of nothing, then a 48px line: the eye had to
            cross the gap to connect a company to its own price.
          */}
          <TickerTile symbol={listing.symbol} />
          <div className="min-w-0">
            {/* No "Held" tag: every held row sits under "Yours". */}
            <div title={listing.name} className="truncate text-[14.5px] leading-snug font-medium text-foreground">{rowName(listing)}</div>
            <div className="money text-xs text-muted-foreground">{listing.symbol}</div>
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
          {/* What tapping the row does, said on the row. A held row's
              Sell covers this same track, so every price lines up. */}
          {!(hasPosition && onSell) && (
            <span aria-hidden="true" className={buttonVariants({ variant: "outline", size: "sm" })}>
              {copy.buy}
            </span>
          )}
        </button>
          {/* Over the row's last track, beside the button rather than in
              it, so the name keeps the width a Buy would have taken. */}
          {hasPosition && onSell && (
            <div className="absolute inset-y-0 right-[18px] flex items-center @lg/row:right-6">
              <motion.div whileTap={{ scale: 0.96 }} transition={SPRING_POP}>
                <Button variant="outline" size="sm" onClick={() => onSell(listing)}>
                  {copy.sell}
                </Button>
              </motion.div>
            </div>
          )}
        </div>

        {/*
          Desktop only, because only there does the news have a column
          of its own to point at. Laid over the right end of the name's
          track (the line starts 18.5rem from the row's edge: padding,
          the Buy track, the price and the line's own width, with their
          gaps), and only its contents fade, so nothing resizes under the
          cursor that is about to click it.
        */}
        {onFilterNews && (
          <div className="absolute inset-y-0 right-[19.75rem] hidden items-center @lg/row:flex">
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
                  ? "border-foreground bg-foreground text-background"
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

      </li>
    );
  };

  return (
    // Named so a row can query THIS element's width rather than the
    // viewport's: the board renders at its full column width on a wide
    // screen but also, unchanged, inside a 24rem side sheet and a capped
    // bottom sheet, both narrower than `lg` ever implies. A viewport
    // breakpoint does not know which one it is in; a container query does.
    <Panel surface="sheet" className="@container/row">
      <SectionHeading
        title={copy.boardTitle}
        hint={copy.boardHint}
        note={
          performance.seriesDays > 0
            ? copy.boardPerformanceNote(performance.seriesDays)
            : undefined
        }
        className="pb-0"
      />
      {yours.length > 0 && (
        <>
          <GroupLabel>{copy.boardYours}</GroupLabel>
          <ul className="divide-y divide-border border-t border-border">{yours.map(row)}</ul>
        </>
      )}
      {/* Only a ranking may be called one: while the day's moves load,
          the label stands over skeletons that hold the rows' place, and
          if the moves never come the first three stand unlabelled in the
          registry's order. */}
      {(ranked || performance.isLoading) && <GroupLabel>{copy.boardMovers}</GroupLabel>}
      {!ranked && performance.isLoading ? (
        <ul aria-hidden className="divide-y divide-border border-t border-border">
          {movers.map((listing) => (
            <li key={listing.address} className="flex min-h-14 items-center gap-2.5 px-[18px] lg:px-6 py-2.5 lg:gap-3">
              <Skeleton className="size-9 rounded-full" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-12" />
              </div>
              <Skeleton className="h-4 w-16" />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="divide-y divide-border border-t border-border">{movers.map(row)}</ul>
      )}
      {/* Always in the page, hidden while closed, so the disclosure's
          aria-controls names a real element; its rows mount on open. */}
      {rest.length > 0 && (
        <ul id={listId} hidden={!open} className="divide-y divide-border border-t border-border">
          {open && rest.map(row)}
        </ul>
      )}
      {rest.length > 0 && !expandAll && (
        <DisclosureRow
          open={open}
          onToggle={toggle}
          controls={listId}
          label={copy.boardAll(STOCK_LISTINGS.length)}
        />
      )}
    </Panel>
  );
}

/** Rows under "Moving most today". */
const MOVERS_SHOWN = 3;

function GroupLabel({ children }: { children: string }) {
  return <p className="border-t border-border bg-background px-[18px] pt-2.5 pb-1.5 text-xs text-muted-foreground lg:px-6">{children}</p>;
}
