"use client";

import { Suspense } from "react";
import { notFound, useSearchParams } from "next/navigation";
import { isAddress, type Address } from "viem";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useHubAccount } from "@/hooks/use-hub-account";
import { useHubHoldings } from "@/hooks/use-hub-holdings";
import { HOME_CHAIN } from "@/lib/account";
import { getChainName } from "@/lib/chains";
import { formatTokenAmount, shortenAddress } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Dev-only account inspector: the hub wallet an address derives to on the
 * home chain, and every listing's balance there, read the way the app reads
 * it. Not linked anywhere; 404 in prod.
 *
 *   /dev/account                      the signed-in Privy account
 *   /dev/account?address=0x…          any spoke address on the home chain
 *   /dev/account?hub=0x…              any hub wallet directly, no derivation
 */
export default function AccountInspectorPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-8">
      <h1 className="font-display text-xl text-foreground">Account inspector</h1>
      <Suspense fallback={<Skeleton className="h-24 w-full" />}>
        <Inspector />
      </Suspense>
    </div>
  );
}

function Inspector() {
  const params = useSearchParams();
  const addressParam = params.get("address") ?? undefined;
  const hubParam = params.get("hub") ?? undefined;
  const override =
    addressParam && isAddress(addressParam) ? addressParam : undefined;
  const directHub =
    hubParam && isAddress(hubParam) ? (hubParam as Address) : undefined;

  const account = useHubAccount(override);
  const hubWallet = directHub ?? account.hubWallet;
  const holdings = useHubHoldings(hubWallet);

  return (
    <>
      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <Row label={`Spoke address on ${getChainName(HOME_CHAIN)}`}>
          {directHub ? (
            <span className="text-muted-foreground">read directly</span>
          ) : account.spokeAddress ? (
            <Mono>{account.spokeAddress}</Mono>
          ) : (
            <span className="text-muted-foreground">
              not signed in; pass ?address=
            </span>
          )}
        </Row>
        <Row label="Hub wallet (the account)">
          {hubWallet ? (
            <Mono>{hubWallet}</Mono>
          ) : account.isLoading ? (
            <Skeleton className="h-4 w-56" />
          ) : account.error ? (
            <span className="text-destructive">{account.error.message}</span>
          ) : (
            <span className="text-muted-foreground">no account</span>
          )}
        </Row>
      </section>

      <section className="rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-[11.5px] font-bold tracking-(--tracking-caps) uppercase text-muted-foreground">
            Holdings on the hub
          </span>
          <span className="text-xs text-muted-foreground">
            {holdings.isLoading
              ? "reading"
              : holdings.error
                ? "read failed"
                : holdings.settled
                  ? `${holdings.held.length} of ${holdings.holdings.length} held`
                  : "no hub wallet"}
          </span>
        </div>
        {holdings.error && (
          <p className="px-4 pb-3 text-xs text-destructive">
            {holdings.error.message}
          </p>
        )}
        <ul className="divide-y divide-border border-t border-border">
          {holdings.holdings.map(({ listing, balance }) => {
            const held = balance > 0n;
            return (
              <li
                key={listing.address}
                className={cn(
                  "flex items-center gap-3 px-4 py-2.5",
                  holdings.settled && !held && "opacity-50",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="money text-sm font-semibold">
                      {listing.symbol}
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      {listing.kind}
                    </Badge>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {listing.name}{" "}
                    <span className="money">
                      {shortenAddress(listing.address)}
                    </span>
                  </div>
                </div>
                <div className="money text-right text-sm tabular-nums">
                  {holdings.isLoading ? (
                    <Skeleton className="h-4 w-16" />
                  ) : holdings.settled ? (
                    formatTokenAmount(balance, listing.decimals, 6)
                  ) : (
                    <span className="text-muted-foreground">?</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-1.5">
      <span className="text-[11px] uppercase tracking-(--tracking-caps) text-muted-foreground">
        {label}
      </span>
      <span className="text-sm">{children}</span>
    </div>
  );
}

function Mono({ children }: { children: string }) {
  return <span className="money break-all text-[12.5px]">{children}</span>;
}
