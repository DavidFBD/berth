"use client";

import { Button } from "@/components/ui/button";
import { SectionHeading } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { useCopy, useMoney } from "@/components/settings-provider";
import { useHubAccount } from "@/hooks/use-hub-account";
import { useHubHoldings } from "@/hooks/use-hub-holdings";
import { useAccountHoldings } from "@/hooks/use-account-holdings";
import type { AccountHolding } from "@/lib/account-holdings";
import { useListingPerformance } from "@/hooks/use-listing-performance";
import { useListingPrices } from "@/hooks/use-listing-prices";
import { useMoves } from "@/hooks/use-moves";
import { shortDate } from "@/components/board/portfolio-summary";
import { DisclosureRow, useDisclosure } from "@/components/board/disclosure";
import { useLastKnown, useOrders, useProfile } from "@/hooks/use-profile";
import { ShareHoldingsOnX } from "@/components/share-holdings-on-x";
import { compareHolding, type HoldingComparison } from "@/lib/benchmark";
import { formatTokenAmount } from "@/lib/format";
import { LISTING_MARK_BY_SYMBOL, TOKEN_LISTINGS, rowName, type TokenListing } from "@/lib/listings";
import { CompanyMark } from "@/components/company-marks";
import { changeDirection, formatPercentChange, type ChangeDirection } from "@/lib/performance";
import { formatUnits, parseUnits } from "viem";
import { cn } from "@/lib/utils";

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
    <p data-ph-mask className="mt-1 flex flex-wrap items-baseline gap-x-1.5 text-[11px] text-muted-foreground">
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
  /**
   * The part in the person's own wallet on Robinhood Chain (plan P1a), when
   * any. `balance` is the whole; `balance - robinhood` sits in the Berth
   * account, the only part a sell spends. Absent on every hub-only row.
   */
  robinhood?: bigint;
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
  const hubHoldings = useHubHoldings(account.hubWallets);
  // Both chains for showing and valuing; Sell still spends the hub alone.
  const holdings = useAccountHoldings(account, hubHoldings);
  const prices = useListingPrices();
  const performance = useListingPerformance();
  const orders = useOrders(Boolean(account.spokeAddress));
  const moves = useMoves();
  const lastKnown = useLastKnown(Boolean(account.spokeAddress)).data;
  const profile = useProfile();

  if (!account.spokeAddress) return null;

  const owned = holdings.held.filter(
    (holding): holding is AccountHolding & { listing: TokenListing } =>
      holding.listing.kind === "stock",
  );
  const loading = !holdings.settled && (account.isLoading || hubHoldings.isLoading);

  // Since the first buy, beside the S&P 500 fund. Every figure is code
  // (lib/benchmark), and a holding it cannot answer honestly shows nothing.
  const spyPerformance = BENCHMARK ? performance.performanceOf(BENCHMARK) : undefined;
  const benchmarkMarks =
    spyPerformance?.series && spyPerformance.seriesDates
      ? { dates: spyPerformance.seriesDates, values: spyPerformance.series }
      : undefined;
  const benchmarkNow = BENCHMARK ? prices.priceOf(BENCHMARK) : undefined;
  const rows: HoldingRow[] = owned.map(({ listing, balance, robinhood }) => {
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
      ...(robinhood > 0n && { robinhood }),
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

  // Still reading the hub: the last reading's rows stand in (lib/last-known),
  // marked as updating and without Sell, which needs the live balance.
  const known = lastKnown?.snapshot;
  if (!holdings.settled && known && known.holdings.length > 0) {
    const knownRows = known.holdings.flatMap((row): HoldingRow[] => {
      const listing = TOKEN_LISTINGS.find((entry) => entry.symbol === row.symbol);
      return listing
        ? [{ listing, balance: parseUnits(row.quantity.toFixed(listing.decimals), listing.decimals), worth: row.worth ?? undefined }]
        : [];
    });
    return (
      <HoldingsView
        rows={knownRows}
        loading={false}
        pricesLoading={false}
        total={known.stocks !== null && known.cash !== null ? known.stocks + known.cash : undefined}
        includesCash={(known.cash ?? 0) > 0}
        onSell={onSell}
        updating
      />
    );
  }

  return (
    <HoldingsView
      rows={rows}
      loading={loading}
      pricesLoading={prices.isLoading}
      total={total}
      includesCash={holdings.held.some((holding) => holding.listing.kind === "cash" && holding.balance > 0n)}
      onSell={onSell}
      inviteCode={profile.data?.referralCode ?? null}
      robinhoodUnread={holdings.robinhoodState === "failed"}
    />
  );
}

/**
 * A listing's mark in a small tile: the company's own mark when one is
 * pinned in the registry (LISTING_MARK_BY_SYMBOL), otherwise the ticker's
 * first letters. Same neutral surface either way, so a covered listing and
 * a lettered one sit at the same weight in a row.
 */
export function TickerTile({ symbol }: { symbol: string }) {
  const mark = LISTING_MARK_BY_SYMBOL[symbol];
  return (
    // data-ph-block: a company mark is fixed path data a replay could read
    // back as a holding, so the tile is left out of replays (lib/analytics).
    <span
      aria-hidden="true"
      data-ph-block
      className="money flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-[9.5px] font-medium tracking-tight text-secondary-foreground"
    >
      {mark ? <CompanyMark id={mark} className="size-4.5" /> : symbol.slice(0, 4)}
    </span>
  );
}

/** Rows shown before "All N holdings". */
const HOLDINGS_SHOWN = 2;

/**
 * The section as drawn, from rows already worked out: its figure (the
 * stocks and funds plus the parked cash, as the comparison line counts
 * them), then the first two holdings and the rest behind "All". The dev
 * gallery (/dev/board?home=…) renders this same view from fixtures.
 */
export function HoldingsView({
  rows,
  loading,
  pricesLoading,
  total,
  includesCash,
  onSell,
  updating = false,
  inviteCode = null,
  shareOpen = false,
  robinhoodUnread = false,
}: {
  /** The Robinhood Chain wallet could not be read: the rows are the Berth account's alone, and a quiet line says so. */
  robinhoodUnread?: boolean;
  /** The person's invite code: with it, and something held, the quiet "Share what you hold on X" link shows. */
  inviteCode?: string | null;
  /** Dev gallery only: that link's sheet open on arrival. */
  shareOpen?: boolean;
  /** The rows are the last reading (lib/last-known), not live: drawn muted, without Sell. */
  updating?: boolean;
  rows: readonly HoldingRow[];
  loading: boolean;
  pricesLoading: boolean;
  total: number | undefined;
  /** Whether cash is parked, and so part of `total`. */
  includesCash: boolean;
  onSell: (listing: TokenListing) => void;
}) {
  const copy = useCopy();
  const money = useMoney();
  const [open, toggle, listId] = useDisclosure("holdings");
  const holdsAnything = !loading && rows.length > 0;
  const shown = open ? rows : rows.slice(0, HOLDINGS_SHOWN);

  return (
    <section data-ph-mask>
      <SectionHeading
        title={copy.holdingsTitle}
        hint={rows.some((row) => row.robinhood !== undefined && row.robinhood > 0n) ? copy.rhChain.holdingsHint : copy.holdingsHint}
        note={holdsAnything ? copy.holdingsSubline : undefined}
        // What the figure counts sits behind the same (i): the account's
        // total is right above, so the page need not say it twice.
        more={
          holdsAnything ? (
            <p className="mt-1.5 text-muted-foreground">
              {includesCash ? `${copy.holdingsCashIncluded} ${copy.holdingsWalletsNote}` : copy.holdingsWalletsNote}
            </p>
          ) : undefined
        }
        action={
          holdsAnything ? (
            total === undefined ? (
              <Skeleton className="h-5 w-16" />
            ) : (
              <span
                data-last-known={updating ? "" : undefined}
                className={cn("money text-[17px] font-medium tabular-nums", updating ? "text-muted-foreground" : "text-foreground")}
              >
                {money.format(total)}
              </span>
            )
          ) : undefined
        }
      />
      {loading ? (
        <div className="flex flex-col gap-2 border-t border-border px-[18px] lg:px-6 py-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-5 w-28" />
        </div>
      ) : rows.length === 0 ? (
        <p className="border-t border-border px-[18px] lg:px-6 py-3 text-sm text-muted-foreground">
          {robinhoodUnread ? copy.rhChain.walletUnread : copy.holdingsEmpty}
        </p>
      ) : (
        <>
          <ul id={listId} className="divide-y divide-border border-t border-border">
            {shown.map(({ listing, balance, worth, move, comparison, robinhood }) => (
              <li
                key={listing.address}
                data-last-known={updating ? "" : undefined}
                className="flex items-center gap-3 px-[18px] py-[13px] lg:px-6"
              >
                <TickerTile symbol={listing.symbol} />
                <div className="min-w-0 flex-1">
                  <div title={listing.name} className="truncate text-[14.5px] leading-snug font-medium text-foreground">{rowName(listing)}</div>
                  <div className="money truncate text-xs text-muted-foreground">
                    {formatTokenAmount(balance, listing.decimals, 6)} {listing.symbol}
                  </div>
                  {/* Where a holding sits, said only when part of it is in
                      the person's own wallet on Robinhood Chain. */}
                  {robinhood !== undefined && robinhood > 0n && (
                    <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                      {robinhood >= balance
                        ? copy.rhChain.holdingInWallet
                        : copy.rhChain.holdingSplit(
                            formatTokenAmount(balance - robinhood, listing.decimals, 6),
                            formatTokenAmount(robinhood, listing.decimals, 6),
                          )}
                    </div>
                  )}
                  {move && (
                    <a
                      href={move.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={copy.moveReadPost(move.name)}
                      className="mt-0.5 flex w-fit items-center gap-1 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    >
                      {copy.moveInTheNews(move.name)}
                    </a>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <div className="money text-sm font-medium tabular-nums text-foreground">
                    {worth !== undefined ? (
                      money.format(worth)
                    ) : pricesLoading ? (
                      <Skeleton className="h-4 w-14" />
                    ) : (
                      <span className="text-muted-foreground">·</span>
                    )}
                  </div>
                  {comparison && (
                    <VersusLine
                      comparison={comparison}
                      withBenchmark={listing.symbol !== BENCHMARK?.symbol}
                    />
                  )}
                </div>
                {/* A sell spends the live balance: offered once it is read.
                    It spends the Berth account only, so a holding wholly
                    on Robinhood Chain offers none yet. */}
                {robinhood !== undefined && robinhood >= balance ? (
                  <span aria-hidden className="w-[3.25rem] shrink-0" />
                ) : (
                  <Button variant="outline" size="xs" disabled={updating} onClick={() => onSell(listing)}>
                    {copy.sell}
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {robinhoodUnread && (
            <p className="border-t border-border px-[18px] py-2.5 text-[11px] text-muted-foreground lg:px-6">
              {copy.rhChain.walletUnread}
            </p>
          )}
          {rows.length > HOLDINGS_SHOWN && (
            <DisclosureRow
              open={open}
              onToggle={toggle}
              controls={listId}
              label={copy.holdingsAll(rows.length)}
            />
          )}
          {inviteCode && !updating && (
            <div className="flex justify-end border-t border-border px-[18px] lg:px-6">
              <ShareHoldingsOnX names={rows.map((row) => rowName(row.listing))} code={inviteCode} defaultOpen={shareOpen} />
            </div>
          )}
        </>
      )}
    </section>
  );
}

/**
 * "+6.4% vs +1.9%": the holding since its first buy, beside the same
 * dollars in the S&P 500 fund on the same days, as the section's (i) says.
 */
function VersusLine({ comparison, withBenchmark }: { comparison: HoldingComparison; withBenchmark: boolean }) {
  const copy = useCopy();
  const pct = (value: number) => {
    const direction = changeDirection(value) ?? "flat";
    return <span className={`money ${TONE[direction]}`}>{formatPercentChange(value, 1)}</span>;
  };
  return (
    <p
      className="mt-0.5 text-[11px] whitespace-nowrap text-muted-foreground"
      title={`${copy.holdingSince(shortDate(comparison.since))}, ${copy.holdingsMarketDays(comparison.tradingDays)}`}
    >
      {pct(comparison.changePct)}
      {withBenchmark && (
        <>
          {" "}
          {copy.holdingVs} <span className="money">{formatPercentChange(comparison.benchmarkChangePct, 1)}</span>
        </>
      )}
    </p>
  );
}
