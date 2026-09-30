"use client";

import { Sparkline } from "@/components/board/sparkline";
import { Panel, SectionHeading } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { useCopy, useMoney } from "@/components/settings-provider";
import { useListingPerformance } from "@/hooks/use-listing-performance";
import { useListingPrices } from "@/hooks/use-listing-prices";
import { STOCK_LISTINGS, rowName } from "@/lib/listings";
import {
  changeDirection,
  formatPercentChange,
  percentChange,
  type ChangeDirection,
} from "@/lib/performance";

const TONE: Record<ChangeDirection, string> = {
  up: "text-good",
  down: "text-bad",
  flat: "text-muted-foreground",
};

/** Six is what fits beside the sign-in without becoming a second page. */
const SHOWN = STOCK_LISTINGS.slice(0, 6);

/**
 * The board, live, on the way in.
 *
 * The front door used to argue for the product in a paragraph. This shows
 * it instead: real prices from the solver oracle and real shape from the
 * daily series, the same numbers a signed-in visitor sees, moving on the
 * same clock. Both routes behind it are public and need no account, which
 * is the only reason this is honest rather than a mock.
 *
 * Read only on purpose. Nothing here opens a drawer, because everything
 * here happens before there is an account to buy into.
 */
export function MarketPreview({ count = SHOWN.length }: { count?: number } = {}) {
  const copy = useCopy();
  const money = useMoney();
  const prices = useListingPrices();
  const performance = useListingPerformance();

  return (
    <Panel surface="sheet" className="w-full text-left">
      <SectionHeading title={copy.welcomePreviewTitle} hint={copy.welcomePreviewHint} />
      <ul className="divide-y divide-border border-t border-border">
        {SHOWN.slice(0, count).map((listing) => {
          const price = prices.priceOf(listing);
          const moved = performance.performanceOf(listing);
          const series = moved?.series;
          const dayDirection = changeDirection(moved?.changePct);
          const lineDirection = changeDirection(
            series ? percentChange(series[0], series[series.length - 1]) : undefined,
          );
          return (
            <li
              key={listing.address}
              className="grid grid-cols-[minmax(0,1fr)_3.5rem_auto] items-center gap-3 px-[18px] lg:px-6 py-2.5"
            >
              <div className="flex min-w-0 items-baseline gap-2">
                <span title={listing.name} className="truncate text-[14.5px] font-medium text-foreground">
                  {rowName(listing)}
                </span>
                <span className="money text-xs text-muted-foreground">
                  {listing.symbol}
                </span>
              </div>
              {series && lineDirection ? (
                <Sparkline
                  values={series}
                  direction={lineDirection}
                  className="h-[16px] w-full"
                />
              ) : (
                <span />
              )}
              <div className="text-right">
                <div className="money text-sm tabular-nums text-foreground">
                  {price !== undefined ? (
                    money.format(price)
                  ) : (
                    <Skeleton className="h-4 w-12" />
                  )}
                </div>
                {moved?.changePct !== undefined && dayDirection && (
                  <div
                    className={`money text-[11px] tabular-nums ${TONE[dayDirection]}`}
                  >
                    {formatPercentChange(moved.changePct)}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
