"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { InfoTip } from "@/components/ui/info-tip";
import { useCopy, useMoney } from "@/components/settings-provider";
import { PortfolioSummary } from "@/components/board/portfolio-summary";
import { useEmbeddedHoldings } from "@/hooks/use-embedded-holdings";
import { useHubAccount } from "@/hooks/use-hub-account";
import { useHubHoldings } from "@/hooks/use-hub-holdings";
import { useListingPrices } from "@/hooks/use-listing-prices";

/** The account's figure in its three parts; undefined while a part loads. */
export type AccountFigures = {
  holdings: number | undefined;
  cash: number | undefined;
  funds: number | undefined;
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
  const holdings = useHubHoldings(account.hubWallet);
  const prices = useListingPrices();

  if (!account.spokeAddress) return null;

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
  const { holdings, cash, funds } = figures;
  const total =
    holdings !== undefined && cash !== undefined && funds !== undefined ? holdings + cash + funds : undefined;
  const parts: { label: string; value: number | undefined }[] = [
    { label: copy.accountSplitHoldings, value: holdings },
    { label: copy.cashTitle, value: cash },
    { label: copy.fundsTitle, value: funds },
  ];

  return (
    <section className="px-1 lg:rounded-2xl lg:border lg:border-border lg:bg-card lg:px-6 lg:pt-5 lg:pb-3 lg:shadow-sheet">
      <div className="flex items-center gap-1 text-[13px] text-muted-foreground">
        <span>{copy.accountTotalLabel}</span>
        {/* The one (i) for the figure and the chart under it. */}
        <InfoTip label={copy.accountTotalLabel}>
          <p>{copy.accountTotalSub}</p>
          {figures.holdsAnything && <p className="mt-1.5 text-muted-foreground">{copy.holdingsBenchmarkNote}</p>}
        </InfoTip>
      </div>
      {total === undefined ? (
        <Skeleton className="mt-1 h-11 w-44" />
      ) : (
        <p className="money mt-0.5 text-[2.75rem] leading-[1.05] font-medium tracking-[-0.03em] tabular-nums text-foreground lg:text-[3.25rem]">
          {money.format(total)}
        </p>
      )}
      <dl className="mt-2.5 flex gap-5 text-[13px] text-muted-foreground">
        {parts.map((part) => (
          <div key={part.label} className="flex flex-col">
            <dt>{part.label}</dt>
            <dd className="money text-sm font-medium tabular-nums text-foreground">
              {part.value === undefined ? <Skeleton className="mt-0.5 h-4 w-12" /> : money.format(part.value)}
            </dd>
          </div>
        ))}
      </dl>
      <PortfolioSummary holdsAnything={figures.holdsAnything} />
    </section>
  );
}
