"use client";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCopy, useMoney } from "@/components/settings-provider";
import { useHubAccount } from "@/hooks/use-hub-account";
import { useHubHoldings } from "@/hooks/use-hub-holdings";
import { useListingPrices } from "@/hooks/use-listing-prices";
import { useTreasuryRate } from "@/hooks/use-treasury-rate";
import { formatTokenAmount } from "@/lib/format";
import { CASH_LISTING } from "@/lib/listings";

/**
 * The cash shelf: idle dollars parked in the Treasury ETF token (SGOV), a
 * plain swap in and out through the same machinery as any listing, never a
 * money-market supply. Shows what is parked, valued by the solver oracle,
 * and the 3 month Treasury bill rate as the yield line, labelled as the
 * bill rate before fund costs because that is what it is.
 */
export function CashShelf({
  onPark,
  onTakeOut,
}: {
  onPark: () => void;
  onTakeOut: () => void;
}) {
  const copy = useCopy();
  const money = useMoney();
  const account = useHubAccount();
  const holdings = useHubHoldings(account.hubWallet);
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
  const ratePct = rate.data?.ratePct ?? null;

  return (
    <section className="rounded-2xl border border-border bg-card px-4 py-3.5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[11.5px] font-bold tracking-(--tracking-caps) uppercase text-muted-foreground">
            {copy.cashTitle}
          </div>
          <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">
            {parked === undefined && account.hubWallet ? (
              <Skeleton className="h-6 w-24" />
            ) : parked !== undefined && parked > 0n ? (
              parkedUsd !== undefined ? (
                money.format(parkedUsd)
              ) : (
                `${formatTokenAmount(parked, CASH_LISTING.decimals, 4)} ${CASH_LISTING.symbol}`
              )
            ) : (
              <span className="text-muted-foreground">{copy.cashEmpty}</span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {ratePct !== null
              ? copy.cashYieldLine(`${ratePct.toFixed(2)}%`)
              : copy.cashHint}
          </p>
          {parked !== undefined && parked > 0n && parkedUsd !== undefined && (
            <p className="money mt-0.5 text-[11.5px] text-muted-foreground">
              {formatTokenAmount(parked, CASH_LISTING.decimals, 4)}{" "}
              {CASH_LISTING.symbol}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col gap-1.5">
          <Button size="sm" onClick={onPark}>
            {copy.cashPark}
          </Button>
          {parked !== undefined && parked > 0n && (
            <Button size="sm" variant="outline" onClick={onTakeOut}>
              {copy.cashTakeOut}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
