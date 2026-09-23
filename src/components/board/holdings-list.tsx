"use client";

import { Button } from "@/components/ui/button";
import { SectionHeading } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { useCopy, useMoney } from "@/components/settings-provider";
import { useHubAccount } from "@/hooks/use-hub-account";
import { useHubHoldings } from "@/hooks/use-hub-holdings";
import { useListingPerformance } from "@/hooks/use-listing-performance";
import { useListingPrices } from "@/hooks/use-listing-prices";
import { useMoves } from "@/hooks/use-moves";
import { JevMark } from "@/components/jev-mark";
import { useOrders } from "@/hooks/use-profile";
import { combine, compareHolding, type HoldingComparison } from "@/lib/benchmark";
import { formatTokenAmount } from "@/lib/format";
import { TOKEN_LISTINGS, type TokenListing } from "@/lib/listings";
import { changeDirection, formatPercentChange, type ChangeDirection } from "@/lib/performance";
import { formatUnits } from "viem";

const BENCHMARK = TOKEN_LISTINGS.find((listing) => listing.symbol === "SPY");

const TONE: Record<ChangeDirection, string> = {
  up: "text-good",
  down: "text-bad",
  flat: "text-muted-foreground",
};

function shortDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * "Since Sep 21, 2 market days  −1.4%  ·  S&P 500 fund +0.3%". One quiet
 * line; the fund half is left off for the S&P 500 fund itself.
 */
export function ComparisonLine({
  comparison,
  label,
  withBenchmark,
}: {
  comparison: HoldingComparison;
  label: string;
  withBenchmark: boolean;
}) {
  const copy = useCopy();
  const pct = (value: number) => {
    const direction = changeDirection(value) ?? "flat";
    return <span className={`money ${TONE[direction]}`}>{formatPercentChange(value, 1)}</span>;
  };
  return (
    <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5 text-[11px] text-muted-foreground">
      {/* Each figure stays with its words when the line wraps. */}
      <span className="whitespace-nowrap">
        {label}, {copy.holdingsMarketDays(comparison.tradingDays)} {pct(comparison.changePct)}
      </span>
      {withBenchmark && (
        <>
          <span aria-hidden="true">·</span>
          <span className="whitespace-nowrap">
            {copy.holdingBenchmark} {pct(comparison.benchmarkChangePct)}
          </span>
        </>
      )}
    </p>
  );
}

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
  const performance = useListingPerformance();
  const orders = useOrders(Boolean(account.spokeAddress));
  const moves = useMoves();

  if (!account.spokeAddress) return null;

  const owned = holdings.held.filter(
    (holding): holding is { listing: TokenListing; balance: bigint } =>
      holding.listing.kind === "stock",
  );
  const loading = !holdings.settled && (account.isLoading || holdings.isLoading);

  // Since the first buy, beside the S&P 500 fund. Every figure is code
  // (lib/benchmark), and a holding it cannot answer honestly shows nothing.
  const spyPerformance = BENCHMARK ? performance.performanceOf(BENCHMARK) : undefined;
  const benchmarkMarks =
    spyPerformance?.series && spyPerformance.seriesDates
      ? { dates: spyPerformance.seriesDates, values: spyPerformance.series }
      : undefined;
  const benchmarkNow = BENCHMARK ? prices.priceOf(BENCHMARK) : undefined;
  const comparisons = new Map<string, HoldingComparison>();
  for (const { listing, balance } of owned) {
    const result = compareHolding({
      orders: (orders.data ?? []).filter((order) => order.symbol === listing.symbol),
      held: Number(formatUnits(balance, listing.decimals)),
      priceNow: prices.priceOf(listing),
      benchmarkNow,
      benchmarkMarks,
    });
    if (result) comparisons.set(listing.symbol, result);
  }
  const together = comparisons.size > 1 ? combine([...comparisons.values()]) : undefined;

  return (
    <section>
      <SectionHeading
        title={copy.holdingsTitle}
        hint={copy.holdingsHint}
        note={comparisons.size > 0 ? copy.holdingsBenchmarkNote : undefined}
      />
      {together && (
        <div className="-mt-1 px-4 pb-2.5">
          <ComparisonLine
            comparison={together}
            label={copy.holdingsTogether(shortDate(together.since))}
            withBenchmark
          />
        </div>
      )}
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
                  {moves.get(listing.symbol) && (
                    <a
                      href={moves.get(listing.symbol)!.post.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={copy.moveReadPost(moves.get(listing.symbol)!.post.name)}
                      className="mt-1 flex w-fit items-center gap-1 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    >
                      <JevMark className="size-2.5" />
                      {copy.moveInTheNews(moves.get(listing.symbol)!.post.name)}
                    </a>
                  )}
                  {comparisons.has(listing.symbol) && (
                    <ComparisonLine
                      comparison={comparisons.get(listing.symbol)!}
                      label={copy.holdingSince(shortDate(comparisons.get(listing.symbol)!.since))}
                      withBenchmark={listing.symbol !== BENCHMARK?.symbol}
                    />
                  )}
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
