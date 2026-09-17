"use client";

import { Button } from "@/components/ui/button";
import { SectionHeading } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { useCopy, useMoney } from "@/components/settings-provider";
import { useHubAccount } from "@/hooks/use-hub-account";
import { useHubHoldings } from "@/hooks/use-hub-holdings";
import { useListingPrices } from "@/hooks/use-listing-prices";
import { formatTokenAmount } from "@/lib/format";
import type { TokenListing } from "@/lib/listings";

/**
 * What the account owns: every stock or fund listing with a balance, valued
 * by the solver oracle, each with a Sell. Cash has its own shelf and vaults
 * their own section, so this list is the brokerage's portfolio view and
 * nothing else. Rendered only for an account; a browser without one has no
 * holdings to show.
 */
export function HoldingsList({
  onSell,
}: {
  onSell: (listing: TokenListing) => void;
}) {
  const copy = useCopy();
  const money = useMoney();
  const account = useHubAccount();
  const holdings = useHubHoldings(account.hubWallet);
  const prices = useListingPrices();

  if (!account.spokeAddress) return null;

  const owned = holdings.held.filter(
    (holding): holding is { listing: TokenListing; balance: bigint } =>
      holding.listing.kind === "stock",
  );
  const loading = !holdings.settled && (account.isLoading || holdings.isLoading);

  return (
    <section>
      <SectionHeading title={copy.holdingsTitle} hint={copy.holdingsHint} />
      {loading ? (
        <div className="flex flex-col gap-2 border-t border-border px-4 py-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-5 w-28" />
        </div>
      ) : owned.length === 0 ? (
        <p className="border-t border-border px-4 py-3 text-sm text-muted-foreground">
          {copy.holdingsEmpty}
        </p>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {owned.map(({ listing, balance }) => {
            const worth = prices.usdValue(listing, balance);
            return (
              <li
                key={listing.address}
                className="flex items-center gap-3 px-4 py-3"
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
                  <div className="money mt-0.5 text-xs text-muted-foreground">
                    {formatTokenAmount(balance, listing.decimals, 6)} {listing.symbol}
                  </div>
                </div>
                <div className="money shrink-0 text-right text-sm font-medium tabular-nums text-foreground">
                  {worth !== undefined ? (
                    money.format(worth)
                  ) : prices.isLoading ? (
                    <Skeleton className="h-4 w-14" />
                  ) : (
                    <span className="text-muted-foreground">·</span>
                  )}
                </div>
                <Button variant="outline" size="xs" onClick={() => onSell(listing)}>
                  {copy.sell}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
