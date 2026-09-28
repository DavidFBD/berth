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
import { PORTFOLIO_STATES, PortfolioGallery, type PortfolioState } from "./portfolio-gallery";
import { RewardsGallery } from "./rewards-gallery";
import { AssistantSection } from "@/components/assistant/assistant-section";
import { ConsentCard } from "@/components/assistant/authorize-consent";
import type { ConsentParty } from "@/lib/assistant-party";
import { Panel } from "@/components/ui/panel";

/**
 * Dev-only account inspector: the hub wallet an address derives to on the
 * home chain, and every listing's balance there, read the way the app reads
 * it. Not linked anywhere; 404 in prod.
 *
 *   /dev/account                      the signed-in Privy account
 *   /dev/account?address=0x…          any spoke address on the home chain
 *   /dev/account?hub=0x…              any hub wallet directly, no derivation
 *   /dev/account?rewards=7            the rewards drawer at that rung, from
 *                                     seeded data (1, 3, 7 and 10 are set
 *                                     scenes; see rewards-gallery.tsx)
 *   /dev/account?portfolio=four-days  the top of "What you own" in one of
 *                                     its states, from fixtures (see
 *                                     portfolio-gallery.tsx)
 *   /dev/account?consent              the assistant consent screen as a
 *                                     signed in person sees it (its answer
 *                                     goes nowhere: the request is fake);
 *                                     =unknown or =loopback for the other
 *                                     two kinds of party; &leaving=1 holds
 *                                     it on "Going back to …"
 *   /dev/account?assistant=claude     the "Your assistant" section with two
 *                                     connected assistants from fixtures,
 *                                     that one's steps unfolded (claude,
 *                                     chatgpt, grok, or none)
 */
/** The assistant fixture's "last used", fixed when the module loads (render stays pure). */
const DEMO_TWO_HOURS_AGO = new Date(Date.now() - 2 * 3600_000).toISOString();

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
  const portfolio = params.get("portfolio");
  if (portfolio && (PORTFOLIO_STATES as readonly string[]).includes(portfolio)) {
    return <PortfolioGallery key={portfolio} state={portfolio as PortfolioState} />;
  }
  if (params.has("consent")) {
    const kind = params.get("consent");
    const [party, host]: [ConsentParty, string] =
      kind === "unknown"
        ? [{ kind: "unknown", host: "helper.example", selfName: "Portfolio Helper" }, "helper.example"]
        : kind === "loopback"
          ? [{ kind: "loopback", selfName: null }, "localhost:33418"]
          : [{ kind: "known", assistant: "claude", name: "Claude" }, "claude.ai"];
    return <ConsentCard key={kind} request="dev-gallery" party={party} redirectHost={host} scopes={["berth.read", "berth.draft"]} initialLeaving={params.get("leaving") === "1"} />;
  }
  const assistant = params.get("assistant");
  if (assistant) {
    const open = assistant === "claude" || assistant === "chatgpt" || assistant === "grok" ? assistant : null;
    return (
      <Panel>
        <AssistantSection
          key={assistant}
          initialOpen={open}
          demoGrants={[
            { id: "demo-1", clientName: "Claude", assistant: "claude", lastUsedAt: DEMO_TWO_HOURS_AGO },
            { id: "demo-2", clientName: "ChatGPT", assistant: "chatgpt", lastUsedAt: null },
          ]}
        />
      </Panel>
    );
  }
  const rewardsLevel = Number(params.get("rewards"));
  if (Number.isInteger(rewardsLevel) && rewardsLevel >= 1 && rewardsLevel <= 10) {
    return <RewardsGallery level={rewardsLevel} />;
  }
  return <HubInspector />;
}

function HubInspector() {
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
