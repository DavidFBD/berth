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
import { PortfolioSummary, shortDate } from "@/components/board/portfolio-summary";
import { useOrders } from "@/hooks/use-profile";
import { compareHolding, type HoldingComparison } from "@/lib/benchmark";
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

/** One owned listing, as the list draws it. */
export type HoldingRow = {
  listing: TokenListing;
  balance: bigint;
  /** Dollars at the oracle's price; undefined while it loads or when it has none. */
  worth: number | undefined;
  /** A post Jev read as related to a big move, if any. */
  move?: { url: string; name: string };
  comparison?: HoldingComparison;
};

/**
 * What the account owns: every stock or fund listing with a balance, valued
 * by the solver oracle, each with a Sell. Cash has its own shelf and vaults
 * their own section, so this list is the brokerage's portfolio view and
 * nothing else. Rendered only for an account; a browser without one has no
 * holdings to show. The top of the section is the portfolio's line over
 * time (PortfolioSummary).
 */
export function HoldingsList({
  onSell,
}: {
  onSell: (listing: TokenListing) => void;
}) {
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
  const rows: HoldingRow[] = owned.map(({ listing, balance }) => {
    const move = moves.get(listing.symbol);
    const comparison = compareHolding({
      orders: (orders.data ?? []).filter((order) => order.symbol === listing.symbol),
      held: Number(formatUnits(balance, listing.decimals)),
      priceNow: prices.priceOf(listing),
      benchmarkNow,
      benchmarkMarks,
    });
    return {
      listing,
      balance,
      worth: prices.usdValue(listing, balance),
      move: move ? { url: move.post.url, name: move.post.name } : undefined,
      comparison: comparison ?? undefined,
    };
  });

  // The figure the line ends on: every listing the history values, which
  // is these rows and the Treasury bills on the cash shelf. Vaults are not
  // counted there, so not here either.
  const valued = holdings.held.filter((holding) => holding.listing.kind !== "vault");
  const total =
    holdings.settled && !prices.isLoading
      ? valued.reduce((sum, holding) => sum + (prices.usdValue(holding.listing, holding.balance) ?? 0), 0)
      : undefined;

  return (
    <HoldingsView
      rows={rows}
      loading={loading}
      pricesLoading={prices.isLoading}
      total={total}
      onSell={onSell}
    />
  );
}

/**
 * The section as drawn, from rows already worked out. The dev gallery
 * (/dev/account?portfolio=…) renders this same view from fixtures.
 */
export function HoldingsView({
  rows,
  loading,
  pricesLoading,
  total,
  onSell,
}: {
  rows: readonly HoldingRow[];
  loading: boolean;
  pricesLoading: boolean;
  total: number | undefined;
  onSell: (listing: TokenListing) => void;
}) {
  const copy = useCopy();
  const money = useMoney();
  const holdsAnything = !loading && rows.length > 0;

  return (
    <section>
      <SectionHeading
        title={copy.holdingsTitle}
        hint={copy.holdingsHint}
        note={holdsAnything ? copy.holdingsBenchmarkNote : undefined}
      />
      <PortfolioSummary total={total} holdsAnything={holdsAnything} />
      {loading ? (
        <div className="flex flex-col gap-2 border-t border-border px-4 py-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-5 w-28" />
        </div>
      ) : rows.length === 0 ? (
        <p className="border-t border-border px-4 py-3 text-sm text-muted-foreground">
          {copy.holdingsEmpty}
        </p>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {rows.map(({ listing, balance, worth, move, comparison }) => (
            <li key={listing.address} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate text-sm font-semibold text-foreground">
                    {listing.name}
                  </span>
                  <span className="money text-xs text-muted-foreground">{listing.symbol}</span>
                </div>
                <div className="money mt-0.5 text-xs text-muted-foreground">
                  {formatTokenAmount(balance, listing.decimals, 6)} {listing.symbol}
                </div>
                {move && (
                  <a
                    href={move.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={copy.moveReadPost(move.name)}
                    className="mt-1 flex w-fit items-center gap-1 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    <JevMark className="size-2.5" />
                    {copy.moveInTheNews(move.name)}
                  </a>
                )}
                {comparison && (
                  <ComparisonLine
                    comparison={comparison}
                    label={copy.holdingSince(shortDate(comparison.since))}
                    withBenchmark={listing.symbol !== BENCHMARK?.symbol}
                  />
                )}
              </div>
              <div className="money shrink-0 text-right text-sm font-medium tabular-nums text-foreground">
                {worth !== undefined ? (
                  money.format(worth)
                ) : pricesLoading ? (
                  <Skeleton className="h-4 w-14" />
                ) : (
                  <span className="text-muted-foreground">·</span>
                )}
              </div>
              <Button variant="outline" size="xs" onClick={() => onSell(listing)}>
                {copy.sell}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
