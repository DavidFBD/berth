"use client";

import { Button } from "@/components/ui/button";
import { SectionHeading } from "@/components/ui/panel";
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
    <section>
      {/* The actions belong to the section, not beside the figure: parking
          cash is what this block is for, and hanging the buttons off the
          number pushed the number out of its own line. */}
      <SectionHeading
        hint={
          ratePct !== null ? copy.cashYieldLine(`${ratePct.toFixed(2)}%`) : copy.cashHint
        }
        title={copy.cashTitle}
        action={
          <div className="flex items-center gap-1.5">
            {parked !== undefined && parked > 0n && (
              <Button size="xs" variant="outline" onClick={onTakeOut}>
                {copy.cashTakeOut}
              </Button>
            )}
            <Button size="xs" onClick={onPark}>
              {copy.cashPark}
            </Button>
          </div>
        }
      />
      <div className="px-4 pb-3.5">
        {parked === undefined && account.hubWallet ? (
          <Skeleton className="h-7 w-28" />
        ) : parked !== undefined && parked > 0n ? (
          // A figure, so the money face and the tight tracking a figure wants.
          <p className="money text-[1.5rem] leading-none font-semibold tracking-[-0.025em] tabular-nums text-foreground">
            {parkedUsd !== undefined
              ? money.format(parkedUsd)
              : `${formatTokenAmount(parked, CASH_LISTING.decimals, 4)} ${CASH_LISTING.symbol}`}
          </p>
        ) : (
          // A sentence, so the sentence face. Setting "Nothing parked yet"
          // in the number face at figure size wrapped it across two lines
          // and read as a broken amount.
          <p className="text-sm text-muted-foreground">{copy.cashEmpty}</p>
        )}
        {parked !== undefined && parked > 0n && parkedUsd !== undefined && (
          <p className="money mt-1 text-[11.5px] tabular-nums text-muted-foreground">
            {formatTokenAmount(parked, CASH_LISTING.decimals, 4)}{" "}
            {CASH_LISTING.symbol}
          </p>
        )}
      </div>
    </section>
  );
}
