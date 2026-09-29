"use client";

import { Bank } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { Skeleton } from "@/components/ui/skeleton";
import { MoneyName } from "@/components/board/money-name";
import { useCopy, useMoney } from "@/components/settings-provider";
import { useHubAccount } from "@/hooks/use-hub-account";
import { useHubHoldings } from "@/hooks/use-hub-holdings";
import { useListingPrices } from "@/hooks/use-listing-prices";
import { useTreasuryRate } from "@/hooks/use-treasury-rate";
import { formatTokenAmount } from "@/lib/format";
import { CASH_LISTING } from "@/lib/listings";

type Actions = { onPark: () => void; onTakeOut: () => void };

/**
 * The cash shelf: idle dollars parked in the Treasury ETF token (SGOV), a
 * plain swap in and out through the same machinery as any listing, never a
 * money-market supply. Shows what is parked, valued by the solver oracle,
 * and the 3 month Treasury bill rate, labelled behind the (i) as the bill
 * rate before fund costs because that is what it is.
 *
 * Parked cash is an SGOV balance at the account's hub wallet, which is a
 * token listing, so it is part of What you own's figure and its line
 * (HoldingsList, lib/server/portfolio). The row says so.
 */
export function CashShelf(actions: Actions) {
  const account = useHubAccount();
  const holdings = useHubHoldings(account.hubWallets);
  const prices = useListingPrices();
  const rate = useTreasuryRate();

  const parked = holdings.settled
    ? (holdings.holdings.find(
        (holding) => holding.listing.address === CASH_LISTING.address,
      )?.balance ?? 0n)
    : undefined;
  const parkedUsd =
    parked !== undefined && parked > 0n
      ? prices.usdValue(CASH_LISTING, parked)
      : undefined;

  return (
    <CashShelfView
      parked={parked}
      parkedUsd={parkedUsd}
      loading={parked === undefined && Boolean(account.hubWallet)}
      ratePct={rate.data?.ratePct ?? null}
      {...actions}
    />
  );
}

/** The row as drawn; the dev gallery renders it from fixtures. */
export function CashShelfView({
  parked,
  parkedUsd,
  loading,
  ratePct,
  onPark,
  onTakeOut,
}: Actions & {
  /** SGOV held, in its smallest unit; undefined while it loads. */
  parked: bigint | undefined;
  parkedUsd: number | undefined;
  loading: boolean;
  ratePct: number | null;
}) {
  const copy = useCopy();
  const money = useMoney();
  const hasCash = parked !== undefined && parked > 0n;
  const rateText = ratePct !== null ? `${ratePct.toFixed(2)}%` : null;
  const figure = hasCash
    ? parkedUsd !== undefined
      ? money.format(parkedUsd)
      : `${formatTokenAmount(parked, CASH_LISTING.decimals, 4)} ${CASH_LISTING.symbol}`
    : undefined;

  return (
    // On a phone the actions drop under the words, in line with them.
    <div className="flex flex-wrap items-center gap-x-3 gap-y-3 px-[18px] py-4 lg:px-6 lg:py-5">
      <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-secondary-foreground">
        <Bank weight="duotone" className="size-[18px]" />
      </span>
      <div className="min-w-0 flex-1 max-sm:basis-[calc(100%-3rem)]">
        <div className="flex items-center gap-1">
          <h2 className="font-display text-base leading-tight text-foreground">
            {figure ? <MoneyName name={copy.cashTitle} amount={figure} /> : copy.cashTitle}
          </h2>
          <InfoTip label={copy.cashTitle}>
            <p>{copy.cashHint}</p>
            {rateText && <p className="mt-1.5 text-muted-foreground">{copy.cashYieldLine(rateText)}</p>}
          </InfoTip>
        </div>
        {loading ? (
          <Skeleton className="mt-1 h-3.5 w-36" />
        ) : (
          <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">
            {hasCash ? (
              <>
                {rateText && <>{copy.cashRate(rateText)} </>}
                {copy.cashCounts}
              </>
            ) : (
              <>
                {copy.cashEmpty} {rateText && copy.cashRate(rateText)}
              </>
            )}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5 max-sm:ml-12">
        {hasCash && (
          <Button size="sm" variant="outline" onClick={onTakeOut}>
            {copy.cashTakeOut}
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={onPark}>
          {hasCash ? copy.cashParkMore : copy.cashPark}
        </Button>
      </div>
    </div>
  );
}
