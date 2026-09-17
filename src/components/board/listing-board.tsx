"use client";

import { CaretRight } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCopy, useMoney } from "@/components/settings-provider";
import { useHubAccount } from "@/hooks/use-hub-account";
import { useHubHoldings } from "@/hooks/use-hub-holdings";
import { useListingPrices } from "@/hooks/use-listing-prices";
import { formatTokenAmount } from "@/lib/format";
import {
  STOCK_LISTINGS,
  type StockCategory,
  type TokenListing,
} from "@/lib/listings";

/** Category, in plain words. Data, not voice. */
const CATEGORY_LABEL: Record<StockCategory, string> = {
  equity: "Stock",
  private: "Private",
  etf: "Fund",
  treasury: "Treasury",
};

/**
 * The board: every stock and fund listing, priced by the solver oracle,
 * with what the account already holds of each. Tapping a row opens the buy
 * drawer for it; a held row also offers a sell. Cash (SGOV) is not on the
 * board; it has its own line.
 */
export function ListingBoard({
  onBuy,
  onSell,
}: {
  onBuy: (listing: TokenListing) => void;
  onSell?: (listing: TokenListing) => void;
}) {
  const copy = useCopy();
  const money = useMoney();
  const account = useHubAccount();
  const holdings = useHubHoldings(account.hubWallet);
  const prices = useListingPrices();

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
      </div>
      <ul className="divide-y divide-border border-t border-border">
        {STOCK_LISTINGS.map((listing) => {
          const price = prices.priceOf(listing);
          const held = heldOf(listing);
          const hasPosition = held !== undefined && held > 0n;
          const heldUsd = hasPosition
            ? prices.usdValue(listing, held)
            : undefined;
          return (
            // Two siblings, never nested buttons: the row buys, the small
            // button sells. Only a held row offers the second.
            <li key={listing.address} className="flex items-stretch">
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
                <div className="money shrink-0 text-right text-sm tabular-nums text-foreground">
                  {price !== undefined ? (
                    money.format(price)
                  ) : prices.isLoading ? (
                    <Skeleton className="h-4 w-14" />
                  ) : (
                    <span className="text-muted-foreground">·</span>
                  )}
                </div>
                {!(hasPosition && onSell) && (
                  <CaretRight className="size-4 shrink-0 text-muted-foreground" />
                )}
              </button>
              {hasPosition && onSell && (
                <div className="flex shrink-0 items-center pr-3">
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => onSell(listing)}
                  >
                    {copy.sell}
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
