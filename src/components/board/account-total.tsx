"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { InfoTip } from "@/components/ui/info-tip";
import { useCopy, useMoney } from "@/components/settings-provider";
import { CaretDown, ChartLineUp } from "@phosphor-icons/react";
import { PortfolioSummary } from "@/components/board/portfolio-summary";
import { useDisclosure } from "@/components/board/disclosure";
import { cn } from "@/lib/utils";
import { useEmbeddedHoldings } from "@/hooks/use-embedded-holdings";
import { useHubAccount } from "@/hooks/use-hub-account";
import { useHubHoldings } from "@/hooks/use-hub-holdings";
import { useListingPrices } from "@/hooks/use-listing-prices";
import { useLimitOrders } from "@/hooks/use-limit-orders";
import { TOKEN_LISTINGS } from "@/lib/listings";
import { accountTotalWith, waitingUsd } from "@/lib/limit-orders";

/** The account's figure in its three parts; undefined while a part loads. */
export type AccountFigures = {
  holdings: number | undefined;
  cash: number | undefined;
  funds: number | undefined;
  /**
   * Money waiting in limit orders (lib/limit-orders waitingUsd): the
   * person's, locked in SODAX's contract until a fill or a cancel, so it is
   * in the total under its own name, never under holdings. 0 when none.
   */
  waiting?: number;
  /** Whether the account owns any stock or fund, which is when the comparison is drawn. */
  holdsAnything: boolean;
};

/**
 * One figure for the whole account: funds the user can spend, plus every
 * stock, fund and cash listing the account holds, valued by the solver
 * oracle. Earlier vault positions are listed in their own section and are
 * not summed here; their value comes from a different oracle and they are
 * not part of what Berth sells. Shown whenever there is an account (an email
 * session or a connected EVM wallet); a browser with neither has no figure.
 */
export function AccountTotal() {
  const funds = useEmbeddedHoldings();
  const account = useHubAccount();
  const holdings = useHubHoldings(account.hubWallets);
  const prices = useListingPrices();
  const limits = useLimitOrders({ poll: false });

  if (!account.spokeAddress) return null;
  const waiting = waitingUsd(limits.waiting, (symbol) => {
    const listing = TOKEN_LISTINGS.find((entry) => entry.symbol === symbol);
    return listing ? prices.priceOf(listing) : undefined;
  }).usd;

  const pricing = holdings.held.some((holding) => holding.listing.kind !== "vault") && prices.isLoading;
  const sum = (kind: "stock" | "cash") =>
    holdings.settled && !pricing
      ? holdings.held.reduce(
          (total, holding) =>
            holding.listing.kind === kind
              ? total + (prices.usdValue(holding.listing, holding.balance) ?? 0)
              : total,
          0,
        )
      : undefined;

  return (
    <AccountTotalView
      figures={{
        holdings: sum("stock"),
        cash: sum("cash"),
        funds: funds.isLoading ? undefined : (funds.totalUsd ?? 0),
        waiting,
        holdsAnything: holdings.settled && holdings.held.some((holding) => holding.listing.kind === "stock"),
      }}
    />
  );
}

/**
 * The top of the board as drawn: the total, its three parts, and under them
 * the account's money beside a benchmark (PortfolioSummary). A card on a
 * desktop, bare on a phone, where the page itself is the card. The dev
 * gallery (/dev/board?home=…) renders this from fixtures.
 */
export function AccountTotalView({ figures }: { figures: AccountFigures }) {
  const copy = useCopy();
  const money = useMoney();
  const [compareOpen, toggleCompare, compareId] = useDisclosure("compare");
  const { holdings, cash, funds } = figures;
  const waiting = figures.waiting ?? 0;
  // What the person owns plus what waits in orders: the parts below always add up to it.
  const total = accountTotalWith([holdings, cash, funds, waiting]);
  const parts: { label: string; value: number | undefined }[] = [
    { label: copy.accountSplitHoldings, value: holdings },
    { label: copy.cashTitle, value: cash },
    { label: copy.fundsTitle, value: funds },
    ...(waiting > 0 ? [{ label: copy.limitWaitingPart, value: waiting }] : []),
  ];

  return (
    <section data-ph-mask className="rounded-lg border border-border bg-card px-[18px] pt-[18px] pb-4 lg:px-6 lg:pt-[22px] lg:pb-5">
      <div className="flex items-center gap-1 text-[13px] text-muted-foreground">
        <span>{copy.accountTotalLabel}</span>
        {/* The one (i) for the figure and the chart under it. */}
        <InfoTip label={copy.accountTotalLabel}>
          <p>{copy.accountTotalSub}</p>
          {figures.holdsAnything && <p className="mt-1.5 text-muted-foreground">{copy.holdingsBenchmarkNote}</p>}
        </InfoTip>
      </div>
      {total === undefined ? (
        <Skeleton className="mt-1.5 mb-3.5 h-11 w-44 lg:mb-[18px] lg:h-14" />
      ) : (
        <p className="money mt-1.5 mb-3.5 text-[2.75rem] leading-[1.05] font-normal tracking-[-0.035em]! tabular-nums text-foreground lg:mt-2 lg:mb-[18px] lg:text-[3.5rem]">
          {money.format(total)}
        </p>
      )}
      {/* The parts as ruled boxes that always add up to the figure above. */}
      <dl className="flex divide-x divide-border overflow-hidden rounded-[10px] border border-border">
        {parts.map((part) => (
          <div key={part.label} className="flex min-w-0 flex-1 flex-col px-3 py-2 lg:px-3.5 lg:py-2.5">
            <dt className="truncate text-xs text-muted-foreground">{part.label}</dt>
            <dd className="money text-[15px] leading-[1.4] font-medium tabular-nums text-foreground">
              {part.value === undefined ? <Skeleton className="mt-0.5 h-4 w-12" /> : money.format(part.value)}
            </dd>
          </div>
        ))}
      </dl>
      {/* The comparison is a weekly look, not the first read: one tap
          under the figure opens it, and the choice is remembered. */}
      {figures.holdsAnything && (
        <>
          <button
            type="button"
            aria-expanded={compareOpen}
            aria-controls={compareId}
            onClick={toggleCompare}
            className="mt-3 -mb-1 flex min-h-9 items-center gap-1.5 rounded-full text-[13px] text-muted-foreground outline-none transition-colors duration-150 ease-lift hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ChartLineUp weight="duotone" aria-hidden className="size-4" />
            {compareOpen ? copy.calmHome.compareHide : copy.calmHome.compareShow}
            <CaretDown
              weight="duotone"
              aria-hidden
              className={cn("size-3.5 transition-transform duration-200 ease-lift", compareOpen && "rotate-180")}
            />
          </button>
          <div id={compareId}>{compareOpen && <PortfolioSummary holdsAnything />}</div>
        </>
      )}
    </section>
  );
}
