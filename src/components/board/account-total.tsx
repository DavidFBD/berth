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
import { shownPart } from "@/lib/last-known";
import { useLastKnown, useOrders } from "@/hooks/use-profile";
import { ThinkingOrb } from "@/components/ui/thinking-orb";
import { formatUnits } from "viem";

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
 * The account's figure as read live right now, part by part (each part
 * undefined while it loads), and whether every part is fully read: the
 * one state in which it may be kept as the account's last known
 * (lib/last-known). Shared by AccountTotal and the home, which saves it.
 */
export function useLiveFigures() {
  const funds = useEmbeddedHoldings();
  const account = useHubAccount();
  const holdings = useHubHoldings(account.hubWallets);
  const prices = useListingPrices();
  const limits = useLimitOrders({ poll: false });

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

  const figures: AccountFigures = {
    holdings: sum("stock"),
    cash: sum("cash"),
    funds: funds.isLoading ? undefined : (funds.totalUsd ?? 0),
    waiting,
    holdsAnything: holdings.settled && holdings.held.some((holding) => holding.listing.kind === "stock"),
  };
  return {
    hasAccount: Boolean(account.spokeAddress),
    figures,
    /** Some network is past its read deadline and still being read: the Funds part is short of it. */
    fundsStillReading: funds.slowChains.length > 0,
    /** Funds were found but none could be priced (the oracle unread): the $0 they add is not their worth. */
    fundsUnpriced: !funds.isLoading && funds.holdings.length > 0 && funds.totalUsd === undefined,
    /** Every part read live and the orders known: the reading may be kept (lib/last-known). */
    complete:
      figures.holdings !== undefined && figures.cash !== undefined && figures.funds !== undefined && !limits.isLoading,
    /** Every network answered and every asset priced: the Funds part is the whole of it. */
    fundsWhole:
      !funds.isLoading &&
      funds.erroredChains.length === 0 &&
      funds.unaddressedChains.length === 0 &&
      !(funds.holdings.length > 0 && funds.totalUsd === undefined),
    /** The stocks and funds held, valued, for a last-known reading. */
    held: holdings.settled
      ? holdings.held
          .filter((holding) => holding.listing.kind === "stock")
          .map((holding) => ({
            symbol: holding.listing.symbol,
            quantity: Number(formatUnits(holding.balance, holding.listing.decimals)),
            worth: prices.usdValue(holding.listing, holding.balance) ?? null,
          }))
      : undefined,
  };
}

/**
 * One figure for the whole account: funds the user can spend, plus every
 * stock, fund and cash listing the account holds, valued by the solver
 * oracle. Earlier vault positions are listed in their own section and are
 * not summed here; their value comes from a different oracle and they are
 * not part of what Berth sells. Shown whenever there is an account (an email
 * session or a connected EVM wallet); a browser with neither has no figure.
 *
 * While a part is still being read live, the account's last-known reading
 * (lib/last-known) stands in for it, marked as updating, so the figure is
 * there at once and each part turns live as it arrives.
 */
export function AccountTotal() {
  const live = useLiveFigures();
  const lastKnown = useLastKnown(live.hasAccount).data;
  // The same query "What you own" reads; asked once for both.
  const orders = useOrders(live.hasAccount).data;

  if (!live.hasAccount) return null;
  const known = lastKnown?.snapshot;
  const holdings = shownPart(live.figures.holdings, known?.stocks);
  const cash = shownPart(live.figures.cash, known?.cash);
  // Past its deadline a network is unknown: the live sum is short of it, and says so.
  const funds = live.fundsStillReading
    ? { value: live.figures.funds, lastKnown: true }
    : live.fundsUnpriced && known?.funds != null
      ? { value: known.funds, lastKnown: true }
      : shownPart(live.figures.funds, known?.funds);

  return (
    <AccountTotalView
      figures={{
        holdings: holdings.value,
        cash: cash.value,
        funds: funds.value,
        waiting: live.figures.waiting,
        holdsAnything: live.figures.holdsAnything || (live.figures.holdings === undefined && known?.stage === "owns"),
      }}
      updating={
        holdings.lastKnown || cash.lastKnown || funds.lastKnown
          ? { holdings: holdings.lastKnown, cash: cash.lastKnown, funds: funds.lastKnown, asOf: lastKnown?.asOf }
          : undefined
      }
      compareOpenByDefault={isNewAccount(orders)}
    />
  );
}

/** For this long after the first buy the comparison opens by itself. */
const NEW_ACCOUNT_DAYS = 30;

/**
 * Whether the first buy is under thirty days old: the weeks in which the
 * line is the account's story, so it opens without a tap until the person
 * hides it once.
 */
export function isNewAccount(
  orders: readonly { direction: string; placedAt: string }[] | undefined,
  now = Date.now(),
): boolean {
  const first = orders
    ?.filter((order) => order.direction === "buy")
    .map((order) => Date.parse(order.placedAt))
    .filter(Number.isFinite)
    .sort((a, b) => a - b)[0];
  return first !== undefined && now - first < NEW_ACCOUNT_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * The top of the board as drawn: the total, its three parts, and under them
 * the account's money beside a benchmark (PortfolioSummary). A card on a
 * desktop, bare on a phone, where the page itself is the card. The dev
 * gallery (/dev/board?home=…) renders this from fixtures.
 */
export function AccountTotalView({
  figures,
  updating,
  compareOpenByDefault = false,
}: {
  figures: AccountFigures;
  /** Which parts are the last reading rather than live (lib/last-known), and when it was read. */
  updating?: { holdings?: boolean; cash?: boolean; funds?: boolean; asOf?: number };
  /** A new account's comparison starts open, until the person hides it (isNewAccount). */
  compareOpenByDefault?: boolean;
}) {
  const copy = useCopy();
  const money = useMoney();
  const [compareOpen, toggleCompare, compareId] = useDisclosure("compare", compareOpenByDefault);
  const { holdings, cash, funds } = figures;
  const waiting = figures.waiting ?? 0;
  // What the person owns plus what waits in orders: the parts below always add up to it.
  const total = accountTotalWith([holdings, cash, funds, waiting]);
  const parts: { label: string; value: number | undefined; lastKnown?: boolean }[] = [
    { label: copy.accountSplitHoldings, value: holdings, lastKnown: updating?.holdings },
    { label: copy.cashTitle, value: cash, lastKnown: updating?.cash },
    { label: copy.fundsTitle, value: funds, lastKnown: updating?.funds },
    ...(waiting > 0 ? [{ label: copy.limitWaitingPart, value: waiting }] : []),
  ];
  const when =
    updating?.asOf !== undefined
      ? new Date(updating.asOf).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
      : undefined;

  return (
    <section data-ph-mask className="rounded-lg border border-border bg-card px-[18px] pt-[18px] pb-4 lg:px-6 lg:pt-[22px] lg:pb-5">
      <div className="flex items-center gap-1 text-[13px] text-muted-foreground">
        <span>{copy.accountTotalLabel}</span>
        {/* The one (i) for the figure and the chart under it. */}
        <InfoTip label={copy.accountTotalLabel}>
          <p>{copy.accountTotalSub}</p>
          {figures.holdsAnything && <p className="mt-1.5 text-muted-foreground">{copy.holdingsBenchmarkNote}</p>}
          {figures.holdsAnything && money.converted && <p className="mt-1.5 text-muted-foreground">{copy.inUsDollarsNote}</p>}
          {updating && when && <p className="mt-1.5 text-muted-foreground">{copy.lastKnownAsOf(when)}</p>}
        </InfoTip>
        {/* The last reading stands in while the live one arrives: said quietly, once. */}
        {updating && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            <ThinkingOrb state="working" size={20} tone="muted" decorative />
            {copy.lastKnownUpdating}
          </span>
        )}
      </div>
      {total === undefined ? (
        <Skeleton className="mt-1.5 mb-3.5 h-11 w-44 lg:mb-[18px] lg:h-14" />
      ) : (
        <p
          data-last-known={updating ? "" : undefined}
          className={cn(
            "money mt-1.5 mb-3.5 text-[2.75rem] leading-[1.05] font-normal tracking-[-0.035em]! tabular-nums lg:mt-2 lg:mb-[18px] lg:text-[3.5rem]",
            updating ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {money.format(total)}
        </p>
      )}
      {/* The parts as ruled boxes that always add up to the figure above. */}
      <dl className="flex divide-x divide-border overflow-hidden rounded-[10px] border border-border">
        {parts.map((part) => (
          <div key={part.label} className="flex min-w-0 flex-1 flex-col px-3 py-2 lg:px-3.5 lg:py-2.5">
            <dt className="truncate text-xs text-muted-foreground">{part.label}</dt>
            <dd
              data-last-known={part.lastKnown && part.value !== undefined ? "" : undefined}
              className={cn(
                "money text-[15px] leading-[1.4] font-medium tabular-nums",
                part.lastKnown ? "text-muted-foreground" : "text-foreground",
              )}
            >
              {part.value === undefined ? <Skeleton className="mt-0.5 h-4 w-12" /> : money.format(part.value)}
            </dd>
          </div>
        ))}
      </dl>
      {/* The comparison is a weekly look, not the first read: one tap
          under the figure opens it, and the choice is remembered. In an
          account's first thirty days it starts open, until hidden once. */}
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
