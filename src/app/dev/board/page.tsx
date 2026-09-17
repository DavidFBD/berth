"use client";

import { Suspense, useState } from "react";
import { notFound, useSearchParams } from "next/navigation";
import { isAddress, type Address } from "viem";
import { CashShelf, ListingBoard, NewsFeed } from "@/components/board";
import { DepositDrawer, WithdrawDrawer } from "@/components/flow";
import { Skeleton } from "@/components/ui/skeleton";
import { useHubHoldings } from "@/hooks/use-hub-holdings";
import { useMounted } from "@/hooks/use-mounted";
import { HOME_CHAIN } from "@/lib/account";
import {
  CASH_LISTING,
  TOKEN_LISTINGS,
  type Listing,
  type TokenListing,
} from "@/lib/listings";

/**
 * Dev-only board gallery: the board outside the sign-in gate, and the buy
 * or sell drawer opened on a listing for review without a session. Not
 * linked anywhere; 404 in prod.
 *
 *   /dev/board                          the board
 *   /dev/board?open=NVDA                the buy drawer open on NVDA
 *   /dev/board?sell=QQQ&hub=0x…         the sell drawer open on QQQ, with
 *                                       what that hub wallet holds of it
 *   /dev/board?news=NVDA                the news column already filtered, so
 *                                       the filtered state can be reviewed
 *                                       without a cursor
 */
export default function BoardGalleryPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-8 sm:max-w-lg lg:max-w-5xl xl:max-w-7xl">
      <h1 className="font-display text-xl text-foreground">The board</h1>
      <Suspense fallback={<Skeleton className="h-40 w-full" />}>
        <Gallery />
      </Suspense>
    </div>
  );
}

function Gallery() {
  const params = useSearchParams();
  const buyWanted = params.get("open");
  const sellWanted = params.get("sell");
  const hubParam = params.get("hub") ?? undefined;
  const hub =
    hubParam && isAddress(hubParam) ? (hubParam as Address) : undefined;

  const initialBuy =
    TOKEN_LISTINGS.find((listing) => listing.symbol === buyWanted) ?? null;
  const initialSell =
    TOKEN_LISTINGS.find((listing) => listing.symbol === sellWanted) ?? null;

  const [buyListing, setBuyListing] = useState<Listing | null>(initialBuy);
  const [buyOpen, setBuyOpen] = useState(initialBuy !== null);
  const [sellListing, setSellListing] = useState<TokenListing | null>(
    initialSell,
  );
  const [sellOpen, setSellOpen] = useState(initialSell !== null);
  const [newsFilter, setNewsFilter] = useState<TokenListing | null>(
    () =>
      TOKEN_LISTINGS.find(
        (listing) => listing.symbol === params.get("news")?.toUpperCase(),
      ) ?? null,
  );

  // The drawers read the wallet store, which only exists in the browser;
  // rendering them on the server threw and fell back to client rendering.
  const mounted = useMounted();
  const holdings = useHubHoldings(hub);
  const available =
    sellListing && holdings.settled
      ? (holdings.holdings.find(
          (holding) => holding.listing.address === sellListing.address,
        )?.balance ?? 0n)
      : 0n;

  return (
    <>
      {/* The same three tracks Home composes, so the desktop layout can be
          reviewed here without a session. */}
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)] lg:items-start lg:gap-5 xl:grid-cols-[minmax(0,20rem)_minmax(0,1fr)_minmax(0,23rem)]">
        <div className="flex flex-col gap-4 lg:col-start-1 lg:row-start-1 lg:row-span-2 xl:row-span-1">
          <CashShelf
            onPark={() => {
              setBuyListing(CASH_LISTING);
              setBuyOpen(true);
            }}
            onTakeOut={() => {
              setSellListing(CASH_LISTING);
              setSellOpen(true);
            }}
          />
        </div>
        <div className="lg:col-start-2 lg:row-start-1">
          <ListingBoard
            onBuy={(picked) => {
              setBuyListing(picked);
              setBuyOpen(true);
            }}
            onSell={(picked) => {
              setSellListing(picked);
              setSellOpen(true);
            }}
            onFilterNews={(picked) =>
              setNewsFilter((current) =>
                current?.symbol === picked.symbol ? null : picked,
              )
            }
            newsFilterSymbol={newsFilter?.symbol}
          />
        </div>
        <div className="lg:col-start-2 lg:row-start-2 xl:col-start-3 xl:row-start-1">
          <NewsFeed
            filter={newsFilter}
            onClearFilter={() => setNewsFilter(null)}
          />
        </div>
      </div>
      {mounted && (
        <>
          <DepositDrawer
            listing={buyListing}
            open={buyOpen}
            onOpenChange={setBuyOpen}
          />
          <WithdrawDrawer
            listing={sellListing}
            open={sellOpen}
            onOpenChange={setSellOpen}
            availableShares={available}
            srcChainKey={HOME_CHAIN}
          />
        </>
      )}
    </>
  );
}
