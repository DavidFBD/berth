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
 */
export default function BoardGalleryPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-8">
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
      <ListingBoard
        onBuy={(picked) => {
          setBuyListing(picked);
          setBuyOpen(true);
        }}
        onSell={(picked) => {
          setSellListing(picked);
          setSellOpen(true);
        }}
      />
      <NewsFeed />
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
