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
import { AddWalletList, SignedInAsLine, UnlinkedWalletLine, WalletsList } from "@/components/account-wallets-list";
import type { AddRow } from "@/lib/add-wallet-list";
import { COPY } from "@/lib/copy";
import { SocialSection } from "@/components/social/social-section";

const DEMO_HOME = "0x3f5ce5fbfe3e9af3971dd833d26ba9b5c936f0be";
const DEMO_SECOND = "0x71c7656ec7ab88b098defb751b7401b5f6d8976f";
const DEMO_UNLINKED = "0xbe0eb53f46cd790cd13851d5eff43d12404d33e8";

const DEMO_SOLANA = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV";
const DEMO_BITCOIN = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";

/** "Add a wallet" opened, one multichain extension (Hana) with every state a row can be in. */
const DEMO_ADD_ROWS: AddRow[] = [
  { network: "EVM", name: COPY.walletsNetworkEvm, address: DEMO_HOME, extension: "Hana", state: "added" },
  { network: "SOLANA", name: "Solana", address: DEMO_SOLANA, extension: "Hana", state: "added" },
  { network: "BITCOIN", name: "Bitcoin", address: DEMO_BITCOIN, extension: "Hana", state: "add" },
  { network: "SUI", name: "Sui", address: "0x02a212de6a9dfa3a69e22387acfbafbb1a9e591bd9d636e7895dcfc8de05f331", extension: "Hana", state: "coming_soon" },
];
const DEMO_ADD_OTHER: AddRow[] = [
  { network: "EVM", name: COPY.walletsNetworkEvm, address: DEMO_UNLINKED, extension: "MetaMask", state: "add" },
  { network: "SOLANA", name: "Solana", address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", extension: "Phantom", state: "other_account" },
];
const DEMO_ADD_CONNECT: AddRow[] = [
  { network: "EVM", name: COPY.walletsNetworkEvm, address: DEMO_HOME, extension: "Rabby", state: "added" },
  { network: "SOLANA", name: "Solana", address: null, extension: null, state: "connect" },
  { network: "BITCOIN", name: "Bitcoin", address: null, extension: null, state: "connect" },
];

/** The Wallets list in one of its states, from fixtures; every act goes nowhere. */
function WalletsGallery({ scene }: { scene: string }) {
  const wallets = [
    { address: DEMO_HOME, isHome: true, holds: true },
    { address: DEMO_SECOND, isHome: false, holds: scene === "remove" },
    ...(scene.startsWith("add") ? [{ address: DEMO_SOLANA, family: "solana", isHome: false, holds: false }] : []),
    // add-bitcoin: the Bitcoin address has joined too.
    ...(scene === "add-bitcoin" ? [{ address: DEMO_BITCOIN, family: "bitcoin", isHome: false, holds: false }] : []),
  ];
  const addRows =
    scene === "add-other"
      ? DEMO_ADD_OTHER
      : scene === "add-cooling"
        ? DEMO_ADD_OTHER.map((row) => (row.network === "SOLANA" ? { ...row, state: "cooling" as const } : row))
        : scene === "add-connect"
          ? DEMO_ADD_CONNECT
          : scene === "add-bitcoin"
            ? DEMO_ADD_ROWS.map((row) => (row.network === "BITCOIN" ? { ...row, state: "added" as const } : row))
            : DEMO_ADD_ROWS;
  return (
    <div className="flex flex-col gap-4">
      {scene === "prompt" && <UnlinkedWalletLine address={DEMO_UNLINKED} busy={false} onAdd={() => {}} onDismiss={() => {}} />}
      {scene === "drawer" && (
        <Panel>
          <SocialSection demo={{ me: { hasEmail: true, handle: "harbourfan", visible: true, nextChangeAt: null, requests: 1 } }} />
        </Panel>
      )}
      {scene === "signed-in-as" && (
        <SignedInAsLine signedIn={DEMO_HOME} connected={DEMO_UNLINKED} busy={false} onSignIn={() => {}} onAdd={() => {}} />
      )}
      <Panel>
        <WalletsList
          key={scene}
          wallets={wallets}
          signedInWith={scene === "email" ? null : DEMO_HOME}
          unlinked={scene === "prompt" ? DEMO_UNLINKED : null}
          homeCanSign={scene !== "home"}
          allowHomeSwitch={scene !== "email"}
          emailSession={scene === "email"}
          busy={false}
          initialConfirm={
            scene === "home"
              ? { kind: "home", address: DEMO_SECOND }
              : scene === "remove"
                ? { kind: "remove", address: DEMO_SECOND }
                : null
          }
          onAdd={() => {}}
          onDismiss={() => {}}
          onMakeHome={() => {}}
          onRemove={() => {}}
          initialAddOpen={scene.startsWith("add")}
          addList={
            <AddWalletList
              rows={addRows}
              comingSoon={scene === "add-connect" ? ["Sui", "Stellar", "ICON"] : ["Stellar", "ICON"]}
              busyAddress={null}
              onAdd={() => {}}
              onConnect={() => {}}
            />
          }
        />
      </Panel>
    </div>
  );
}

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
 *   /dev/account?wallets=two          the account drawer's Wallets list from
 *                                     fixtures: two (home and a second),
 *                                     prompt (a connected wallet not on the
 *                                     account), home (confirming a new
 *                                     home), remove (removing one that still
 *                                     holds listings), email (an email
 *                                     session, no Make home), signed-in-as
 *                                     (the board line while an unproved
 *                                     extension wallet is connected),
 *                                     add, add-other, add-cooling, add-connect,
 *                                     add-bitcoin (Add a wallet opened: one
 *                                     multichain extension's networks and
 *                                     their states, a wallet on another
 *                                     account, Connect Solana and Bitcoin,
 *                                     a Bitcoin address already joined),
 *                                     drawer (Your profile above Wallets, as in the
 *                                     account drawer)
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
  const walletsScene = params.get("wallets");
  if (walletsScene) return <WalletsGallery scene={walletsScene} />;
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
