"use client";

import { DevAvailability } from "@/components/availability/dev-availability";
import { Suspense, useEffect, useState } from "react";
import { ChainKeys } from "@sodax/sdk";
import { notFound, useSearchParams } from "next/navigation";
import { isAddress, type Address } from "viem";
import {
  CashShelf,
  HoldingsList,
  ListingBoard,
  NewsFeed,
  ComparisonLine,
  NudgeLineView,
} from "@/components/board";
import { FundsModule } from "@/components/funds-module";
import { HomeGallery } from "./home-gallery";
import { PathGallery } from "./path-gallery";
import { mostHeldFor, socialProofFor } from "./social-proof-fixtures";
import { LINE_FIXTURES } from "../campaigns/fixtures";
import { DepositDrawer, WithdrawDrawer } from "@/components/flow";
import { ActionStepper } from "@/components/flow/action-stepper";
import { Panel } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { useHubHoldings } from "@/hooks/use-hub-holdings";
import { useMounted } from "@/hooks/use-mounted";
import type { VaultActionStep } from "@/hooks/use-vault-action";
import { HOME_CHAIN } from "@/lib/account";
import { getDepositTokens } from "@/lib/chains";
import type { EmbeddedHoldingsResult } from "@/hooks/use-embedded-holdings";
import { NUDGE_KINDS, type Nudge } from "@/lib/nudge";
import {
  CASH_LISTING,
  TOKEN_LISTINGS,
  type Listing,
  type TokenListing,
} from "@/lib/listings";

/**
 * Dev-only board gallery: the board outside the sign-in gate, and the buy
 * or sell drawer opened on a listing for review without a session. Not
 * linked anywhere; 404 in prod.
 *
 *   /dev/board                          the board
 *   /dev/board?open=NVDA                the buy drawer open on NVDA
 *   /dev/board?open=NVDA&usd=50         the same, prefilled as an assistant's
 *                                       draft would (lib/draft-order)
 *   /dev/board?open=NVDA&usd=50&pay=slow
 *                                       the wallet sweep stood in for: still
 *                                       loading for `delay` ms (default
 *                                       6000), then holding 10 POL on
 *                                       Polygon. pay=empty settles with
 *                                       nothing, pay=stuck never settles,
 *                                       pay=gas holds USDC on HyperEVM with
 *                                       no HYPE (a greyed picker row),
 *                                       pay=hold a priced and an unpriced
 *                                       holding side by side
 *   /dev/board?sell=QQQ&hub=0x…         the sell drawer open on QQQ, with
 *                                       what that hub wallet holds of it
 *   /dev/board?news=NVDA                the news column already filtered, so
 *                                       the filtered state can be reviewed
 *                                       without a cursor
 *   /dev/board?home=held                the signed-in board as Home lays it
 *                                       out, from fixtures (home-gallery.tsx);
 *                                       home=empty for a new account with no
 *                                       money, home=new funded but holding
 *                                       nothing, &dock=0
 *                                       without the docked Ask
 *   /dev/board?home=path                the guided first path, walked live from
 *                                       fixtures (path-gallery.tsx: &account=wallet,
 *                                       &at=, &skipped=, &drawer=1, &done=)
 *   /dev/board?proof=1                  the social counts from fixtures
 *                                       (social-proof-fixtures.ts): most bought
 *                                       and most held on Berth (&news=NVDA for
 *                                       most held's line in the news column);
 *                                       proof=0 the quiet week; also on a home
 *                                       scene with &drawer=board
 *   /dev/board?open=NVDA&country=US     any of these as seen where Berth is
 *                                       not available (lib/availability): the
 *                                       buy drawer is the soft landing, the
 *                                       home scenes carry the banner
 *   /dev/board?stepper=approving        the working stepper on its own, held
 *                                       on one step (building, approving or
 *                                       signing) without a wallet; &approve=0
 *                                       marks Approve skipped
 */
export default function BoardGalleryPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <Suspense fallback={<Skeleton className="h-40 w-full" />}>
      <DevAvailability>
        <Galleries />
      </DevAvailability>
    </Suspense>
  );
}

function Galleries() {
  const params = useSearchParams();
  const stepperWanted = params.get("stepper");
  if (stepperWanted === "building" || stepperWanted === "approving" || stepperWanted === "signing") {
    return (
      <div className="mx-auto flex min-h-[70vh] w-full max-w-sm items-center justify-center px-4 py-8">
        <Panel className="w-full">
          <ActionStepper
            step={stepperWanted as VaultActionStep}
            approveNeeded={params.get("approve") !== "0"}
          />
        </Panel>
      </div>
    );
  }
  const home = params.get("home");
  if (home === "path") {
    return (
      <PathGallery
        key={params.toString()}
        account={params.get("account") === "wallet" ? "wallet" : "email"}
        at={params.get("at")}
        skipped={params.get("skipped")}
        drawer={params.get("drawer") === "1"}
        done={params.get("done")}
        campaign={LINE_FIXTURES[params.get("campaign") ?? ""]}
      />
    );
  }
  if (home === "held" || home === "new" || home === "empty" || home === "cash" || home === "walletEmail") {
    const drawer = params.get("drawer");
    return (
      <HomeGallery
        key={home}
        scene={home}
        dock={params.get("dock") !== "0"}
        streaming={params.get("streaming") === "1"}
        drawer={drawer === "board" || drawer === "news" ? drawer : null}
        look={params.get("look") === "fixture" || params.get("look") === "quiet" ? (params.get("look") as "fixture" | "quiet") : undefined}
        firstStock={params.get("first") === "1"}
        campaign={LINE_FIXTURES[params.get("campaign") ?? ""]}
        proof={params.get("proof")}
      />
    );
  }
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-8 sm:max-w-lg lg:max-w-5xl xl:max-w-7xl">
      <h1 className="font-display text-xl text-foreground">The board</h1>
      <Suspense fallback={<Skeleton className="h-40 w-full" />}>
        <Gallery />
      </Suspense>
    </div>
  );
}

function Gallery() {
  const params = useSearchParams();
  const buyWanted = params.get("open");
  const sellWanted = params.get("sell");
  const hubParam = params.get("hub") ?? undefined;
  const hub =
    hubParam && isAddress(hubParam) ? (hubParam as Address) : undefined;

  const initialBuy =
    TOKEN_LISTINGS.find((listing) => listing.symbol === buyWanted) ?? null;
  const initialSell =
    TOKEN_LISTINGS.find((listing) => listing.symbol === sellWanted) ?? null;

  const [buyListing, setBuyListing] = useState<Listing | null>(initialBuy);
  const [buyOpen, setBuyOpen] = useState(initialBuy !== null);
  const draftUsd = Number(params.get("usd"));
  const buyPrefill = Number.isFinite(draftUsd) && draftUsd > 0 ? { usd: draftUsd } : null;
  const [sellListing, setSellListing] = useState<TokenListing | null>(
    initialSell,
  );
  const [sellOpen, setSellOpen] = useState(initialSell !== null);
  const [newsFilter, setNewsFilter] = useState<TokenListing | null>(
    () =>
      TOKEN_LISTINGS.find(
        (listing) => listing.symbol === params.get("news")?.toUpperCase(),
      ) ?? null,
  );

  const devHoldings = useDevHoldings(params.get("pay"), Number(params.get("delay") ?? 6000));

  // ?nudge=kind previews one line; none of them needs a session here.
  const nudgeWanted = params.get("nudge") ?? "heldNews";
  const [nudge, setNudge] = useState<Nudge | null>(() =>
    nudgeWanted === "none"
      ? null
      : nudgeWanted === "heldNews"
        ? { kind: "heldNews", symbol: "NVDA", name: "NVIDIA", postUrl: "https://x.com/FirstSquawk" }
        : (NUDGE_KINDS as readonly string[]).includes(nudgeWanted)
          ? ({ kind: nudgeWanted } as Nudge)
          : null,
  );

  // The drawers read the wallet store, which only exists in the browser;
  // rendering them on the server threw and fell back to client rendering.
  const mounted = useMounted();
  const holdings = useHubHoldings(hub);
  const available =
    sellListing && holdings.settled
      ? (holdings.holdings.find(
          (holding) => holding.listing.address === sellListing.address,
        )?.balance ?? 0n)
      : 0n;

  return (
    <>
      <NudgeLineView
        nudge={nudge}
        onDismiss={() => setNudge(null)}
        onAddFunds={() => {}}
        onParkCash={() => {
          setBuyListing(CASH_LISTING);
          setBuyOpen(true);
        }}
        onOpenAccount={() => {}}
      />
      {/* "Since your first buy" beside the S&P 500 fund, as the holdings
          rows set it, with the figures from David's account on 2026-09-23. */}
      <Panel className="px-4 py-3">
        <ComparisonLine
          comparison={{ since: "2026-09-21", paid: 7.42, worth: 7.28, changePct: -1.9, benchmarkWorth: 7.53, benchmarkChangePct: 1.5, tradingDays: 2 }}
          label="All of it since Sep 21"
          withBenchmark
        />
        <ComparisonLine
          comparison={{ since: "2026-09-21", paid: 4.56, worth: 4.46, changePct: -2.1, benchmarkWorth: 4.62, benchmarkChangePct: 1.5, tradingDays: 2 }}
          label="Since Sep 21"
          withBenchmark
        />
      </Panel>
      {/* The same three tracks Home composes, so the desktop layout can be
          reviewed here without a session. */}
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)] lg:items-start lg:gap-5 xl:grid-cols-[minmax(0,20rem)_minmax(0,1fr)_minmax(0,23rem)]">
        {/* The account rail as Home composes it, so the panel's internal
            rules and every signed-out empty state can be reviewed here. */}
        <Panel className="divide-y divide-border lg:col-start-1 lg:row-start-1 lg:row-span-2 xl:row-span-1">
          {/* Same guard the drawers need: this reads the wallet store, which
              only exists in the browser, and server-rendering it throws. */}
          {mounted && <FundsModule onTopUp={() => {}} />}
          <HoldingsList onSell={(picked) => { setSellListing(picked); setSellOpen(true); }} />
          <CashShelf
            onPark={() => {
              setBuyListing(CASH_LISTING);
              setBuyOpen(true);
            }}
            onTakeOut={() => {
              setSellListing(CASH_LISTING);
              setSellOpen(true);
            }}
          />
        </Panel>
        <div className="lg:col-start-2 lg:row-start-1">
          <ListingBoard
            onBuy={(picked) => {
              setBuyListing(picked);
              setBuyOpen(true);
            }}
            onSell={(picked) => {
              setSellListing(picked);
              setSellOpen(true);
            }}
            onFilterNews={(picked) =>
              setNewsFilter((current) =>
                current?.symbol === picked.symbol ? null : picked,
              )
            }
            newsFilterSymbol={newsFilter?.symbol}
            {...socialProofFor(params.get("proof"))}
          />
        </div>
        <div className="lg:col-start-2 lg:row-start-2 xl:col-start-3 xl:row-start-1 xl:self-stretch xl:[contain:size]">
          <NewsFeed
            filter={newsFilter}
            onClearFilter={() => setNewsFilter(null)}
            {...mostHeldFor(params.get("proof"))}
            limit={6}
            fill
          />
        </div>
      </div>
      {mounted && (
        <>
          <DepositDrawer
            listing={buyListing}
            prefill={buyPrefill}
            devHoldings={devHoldings}
            open={buyOpen}
            onOpenChange={setBuyOpen}
          />
          <WithdrawDrawer
            listing={sellListing}
            open={sellOpen}
            onOpenChange={setSellOpen}
            availableShares={available}
            srcChainKey={HOME_CHAIN}
          />
        </>
      )}
    </>
  );
}

type DevHoldings = Pick<
  EmbeddedHoldingsResult,
  "connected" | "holdings" | "gasShortChains" | "isLoading" | "nativeBalances"
>;

/**
 * ?pay=gas: a wallet holding USDC on HyperEVM with no HYPE beside it, and
 * USDC and ETH on Base, so the picker shows a greyed HyperEVM row and its
 * (?) next to rows that can pay (lib/gas-need).
 */
function gasFixture(): DevHoldings {
  const hyperUsdc = getDepositTokens(ChainKeys.HYPEREVM_MAINNET).find((token) => token.symbol.startsWith("USDC"));
  const baseUsdc = getDepositTokens(ChainKeys.BASE_MAINNET).find((token) => token.symbol === "USDC");
  const baseEth = getDepositTokens(ChainKeys.BASE_MAINNET).find((token) => token.symbol === "ETH");
  const holdings = [
    hyperUsdc && { chainKey: ChainKeys.HYPEREVM_MAINNET, token: hyperUsdc, balance: 40n * 10n ** BigInt(hyperUsdc.decimals), usdValue: 40 },
    baseUsdc && { chainKey: ChainKeys.BASE_MAINNET, token: baseUsdc, balance: 25n * 10n ** BigInt(baseUsdc.decimals), usdValue: 25 },
    baseEth && { chainKey: ChainKeys.BASE_MAINNET, token: baseEth, balance: 10n ** 16n, usdValue: 38 },
  ].filter((holding) => !!holding);
  return {
    connected: true,
    holdings,
    gasShortChains: [ChainKeys.HYPEREVM_MAINNET],
    isLoading: false,
    nativeBalances: { [ChainKeys.HYPEREVM_MAINNET]: 0n, [ChainKeys.BASE_MAINNET]: 10n ** 16n },
  };
}

/**
 * ?pay=hold: a priced and an unpriced holding side by side, so the picker's
 * worth-first rows (value on top, amount beneath) and the no-price fallback
 * (amount on top, symbol beneath) can be seen in one shot.
 */
function holdFixture(): DevHoldings {
  const baseUsdc = getDepositTokens(ChainKeys.BASE_MAINNET).find((token) => token.symbol === "USDC");
  const baseEth = getDepositTokens(ChainKeys.BASE_MAINNET).find((token) => token.symbol === "ETH");
  const pol = getDepositTokens(ChainKeys.POLYGON_MAINNET).find((token) => token.symbol === "POL");
  const holdings = [
    baseUsdc && { chainKey: ChainKeys.BASE_MAINNET, token: baseUsdc, balance: 25n * 10n ** BigInt(baseUsdc.decimals), usdValue: 25 },
    baseEth && { chainKey: ChainKeys.BASE_MAINNET, token: baseEth, balance: 6n * 10n ** 15n, usdValue: 16.21 },
    pol && { chainKey: ChainKeys.POLYGON_MAINNET, token: pol, balance: 10n * 10n ** 18n, usdValue: undefined },
  ].filter((holding) => !!holding);
  return {
    connected: true,
    holdings,
    gasShortChains: [],
    isLoading: false,
    nativeBalances: { [ChainKeys.BASE_MAINNET]: 6n * 10n ** 15n, [ChainKeys.POLYGON_MAINNET]: 10n * 10n ** 18n },
  };
}

/** A stand-in wallet sweep for ?pay=slow|empty|stuck, so the drawer's waiting states can be seen. */
function useDevHoldings(mode: string | null, delayMs: number): DevHoldings | undefined {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (mode !== "slow" && mode !== "empty") return;
    const timer = setTimeout(() => setSettled(true), Number.isFinite(delayMs) ? delayMs : 6000);
    return () => clearTimeout(timer);
  }, [mode, delayMs]);
  if (mode === "gas") return gasFixture();
  if (mode === "hold") return holdFixture();
  if (mode !== "slow" && mode !== "empty" && mode !== "stuck") return undefined;
  const pol = getDepositTokens(ChainKeys.POLYGON_MAINNET).find((token) => token.symbol === "POL");
  const holdings =
    settled && mode === "slow" && pol
      ? [{ chainKey: ChainKeys.POLYGON_MAINNET, token: pol, balance: 10n * 10n ** 18n, usdValue: undefined }]
      : [];
  return { connected: true, holdings, gasShortChains: [], isLoading: !settled, nativeBalances: {} };
}
