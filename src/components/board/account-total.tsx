"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useCopy, useMoney } from "@/components/settings-provider";
import { useEmbeddedHoldings } from "@/hooks/use-embedded-holdings";
import { useHubAccount } from "@/hooks/use-hub-account";
import { useHubHoldings } from "@/hooks/use-hub-holdings";
import { useListingPrices } from "@/hooks/use-listing-prices";

/**
 * One figure for the whole account: funds the user can spend, plus every
 * stock, fund and cash listing the account holds, valued by the solver
 * oracle. Earlier vault positions are listed in their own section and are
 * not summed here; their value comes from a different oracle and they are
 * not part of what Berth sells. Shown whenever there is an account (an email
 * session or a connected EVM wallet); a browser with neither has no figure.
 */
export function AccountTotal() {
  const copy = useCopy();
  const money = useMoney();
  const funds = useEmbeddedHoldings();
  const account = useHubAccount();
  const holdings = useHubHoldings(account.hubWallet);
  const prices = useListingPrices();

  if (!account.spokeAddress) return null;

  const holdingsUsd = holdings.settled
    ? holdings.held.reduce((sum, holding) => {
        if (holding.listing.kind === "vault") return sum;
        return sum + (prices.usdValue(holding.listing, holding.balance) ?? 0);
      }, 0)
    : undefined;
  const ready =
    !funds.isLoading &&
    holdingsUsd !== undefined &&
    !(holdings.held.some((holding) => holding.listing.kind !== "vault") && prices.isLoading);
  const total = ready ? (funds.totalUsd ?? 0) + (holdingsUsd ?? 0) : undefined;

  return (
    // The one figure the page is about, so it is the one thing set large.
    // It was a letter-spaced capital label over a 36px number, at the same
    // pitch as the seven section labels under it; nothing said this was the
    // page's subject. Now the label is quiet, the figure is the anchor, and
    // the tracking tightens as the size grows, the way a number set this
    // large needs.
    <section className="mb-5 flex flex-col gap-1.5 px-1">
      <span className="text-xs text-muted-foreground">
        {copy.accountTotalLabel}
      </span>
      {total === undefined ? (
        <Skeleton className="h-11 w-44" />
      ) : (
        <span className="money text-[2.625rem] leading-none font-semibold tracking-[-0.035em] tabular-nums text-foreground sm:text-[3rem]">
          {money.format(total)}
        </span>
      )}
      <span className="text-xs text-muted-foreground">{copy.accountTotalSub}</span>
    </section>
  );
}
