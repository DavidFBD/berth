"use client";

import { NotHereBanner } from "@/components/availability/availability";
import { socialProofFor } from "./social-proof-fixtures";
import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { parseUnits } from "viem";
import { HomeHeader, HomeTracks, BOARD_PAGE } from "@/components/home";
import { AddMoneyStep, BuyMoreButton, FirstBuyStep } from "@/components/home-next-step";
import { HomeMore, SectionDrawer } from "@/components/home-more";
import { NUDGES_SAID_BY_STEP, type HomeStage } from "@/lib/home-stage";
import { AccountTotalView } from "@/components/board/account-total";
import { CashShelfView } from "@/components/board/cash-shelf";
import { EmailNudgeLineView, HoldingsView, ListingBoard, NewsFeed, NudgeLineView } from "@/components/board";
import { FundsModule } from "@/components/funds-module";
import { AskCard, AskDock, DOCK_CLEARANCE } from "@/components/chat/ask-surfaces";
import { RankChip } from "@/components/rewards-panel";
import { Panel } from "@/components/ui/panel";
import { useCopy } from "@/components/settings-provider";
import type { EmbeddedHoldingsResult } from "@/hooks/use-embedded-holdings";
import { useMounted } from "@/hooks/use-mounted";
import { HOME_CHAIN } from "@/lib/account";
import { getDepositTokens } from "@/lib/chains";
import { CASH_LISTING, type TokenListing } from "@/lib/listings";
import type { Nudge } from "@/lib/nudge";
import { cn } from "@/lib/utils";
import { seededPortfolioClient } from "../account/portfolio-gallery";
import { FirstStockCard } from "@/components/first-look";
import { FIRST_LOOK_QUERY_KEY } from "@/hooks/use-first-look";
import { FIRST_LOOK_SYMBOLS, type FirstLookResponse } from "@/lib/first-look";
import { FIXTURE_STORIES } from "./first-look-fixture";
import type { StoryCard } from "@/lib/news-stories";
import { STOCK_LISTINGS } from "@/lib/listings";
import { CampaignLineView } from "@/components/board/campaign-line";
import { campaignLine, type CampaignProgress } from "@/lib/campaigns";

/**
 * The first look's fixture (lib/first-look): NVIDIA in today's news, Apple in
 * the news this past week, Tesla with no news line and a large move, the S&P
 * 500 fund with no news line (no box). `&look=quiet` is a week where nothing
 * passed for any of the four: no news line anywhere.
 */
function firstLookFixture(look: "fixture" | "quiet"): FirstLookResponse {
  const asOf = Date.now();
  const silent = { looked: false, inNews: false, inNewsWeek: false };
  if (look === "quiet") {
    return { judged: true, asOf, looks: Object.fromEntries(FIRST_LOOK_SYMBOLS.map((symbol) => [symbol, silent])) };
  }
  return {
    judged: true,
    asOf,
    looks: {
      NVDA: { looked: true, inNews: true, inNewsWeek: true, story: FIXTURE_STORIES.NVDA() },
      AAPL: { looked: false, inNews: false, inNewsWeek: true, story: FIXTURE_STORIES.AAPL() },
      TSLA: { ...silent, movePct: -3.6 },
      SPY: silent,
    },
  };
}

/**
 * Dev-only: the signed-in board as Home composes it, from fixtures, so the
 * ledger layout can be reviewed (and shot) without a session.
 *
 *   /dev/board?home=held    three holdings, cash parked, funds waiting,
 *                           the comparison drawn from real closes
 *   /dev/board?home=empty   a new account with no money yet: nothing to
 *                           spend, nothing held
 *   /dev/board?home=new     funded, nothing held yet: funds only
 *   /dev/board?home=cash    nothing to spend, nothing held, $20 parked as
 *                           cash: the total above Add money, which offers
 *                           to take cash out
 *   /dev/board?home=walletEmail
 *                           a wallet-only account (no verified email) after
 *                           its first buy: the email nudge strip in place of
 *                           the standing nudge line (lib/email-nudge)
 *
 * The prices, the board's lines and the news are live, from the same public
 * routes the app reads. Actions go nowhere, except that the board and the
 * news open in their drawers (`&drawer=board`, `&drawer=news` to start
 * there). `&dock=0` hides the docked Ask;
 * `&streaming=1` shows it as it is while an answer comes in.
 */
export type HomeScene = "held" | "new" | "empty" | "cash" | "walletEmail";

function fundsFixture(held: boolean, empty = false): EmbeddedHoldingsResult {
  const usdc = getDepositTokens(HOME_CHAIN).find((token) => token.symbol === "USDC");
  const holdings = usdc && !empty
    ? [{ chainKey: HOME_CHAIN, token: usdc, balance: parseUnits(held ? "2.40" : "25", usdc.decimals), usdValue: held ? 2.4 : 25 }]
    : [];
  return {
    emailMode: true,
    connected: true,
    unaddressedChains: [],
    isLoading: false,
    holdings,
    erroredChains: [],
    slowChains: [],
    gasShortChains: [],
    nativeBalances: {},
    // The hook says undefined, not 0, when nothing is priced.
    totalUsd: empty ? undefined : held ? 2.4 : 25,
  };
}

export function HomeGallery({
  scene,
  dock,
  streaming = false,
  drawer: initialDrawer = null,
  look,
  firstStock = false,
  campaign,
  proof = null,
  share = null,
  robinhood = null,
}: {
  /**
   * `&rh=1` on a held scene: a switched account whose first holding sits
   * wholly in its own wallet on Robinhood Chain (plan P1a); `&rh=split`
   * the same holding half there, half in the Berth account.
   */
  robinhood?: string | null;
  /** `&share=1`: the "Share what you hold on X" link with a fixture invite code; `&share=open` with its sheet open. */
  share?: string | null;
  /** `&proof=1` (or 0): the social counts on the board drawer from fixtures (social-proof-fixtures.ts). */
  proof?: string | null;
  /** `&campaign=setUp` (staying, qualified, paid): the campaign line, from /dev/campaigns' fixtures. */
  campaign?: CampaignProgress;
  /** Seeds the first look (`&look=fixture` or `&look=quiet`); absent asks the live route. */
  look?: "fixture" | "quiet";
  /** `&first=1` on a held scene: the first stock's card, on NVIDIA. */
  firstStock?: boolean;
  scene: HomeScene;
  dock: boolean;
  streaming?: boolean;
  drawer?: "board" | "news" | null;
}) {
  const [drawer, setDrawer] = useState<"board" | "news" | null>(initialDrawer);
  const walletEmail = scene === "walletEmail";
  const held = scene === "held" || walletEmail;
  const [{ client, rows: seededRows }] = useState(() => {
    const seeded = seededPortfolioClient(held ? "three-months" : "empty", { xp: 900 });
    if (look) seeded.client.setQueryData(FIRST_LOOK_QUERY_KEY, firstLookFixture(look));
    return seeded;
  });
  const rows = seededRows.map((row, index) =>
    index === 0 && (robinhood === "1" || robinhood === "split")
      ? { ...row, robinhood: robinhood === "split" ? row.balance / 2n : row.balance }
      : row,
  );
  const robinhoodMap = new Map(rows.flatMap((row) => (row.robinhood ? [[row.listing.address, row.robinhood] as const] : [])));
  const [firstOpen, setFirstOpen] = useState(firstStock);
  const nvidia = STOCK_LISTINGS.find((listing) => listing.symbol === "NVDA");
  const mounted = useMounted();
  const [nudge, setNudge] = useState<Nudge | null>(
    held
      ? { kind: "heldNews", symbol: "NVDA", name: "NVIDIA", postUrl: "https://x.com/nvidianewsroom" }
      : scene === "empty" || scene === "cash"
        ? { kind: "addFunds" }
        : { kind: "firstBuy" },
  );
  const [newsFilter, setNewsFilter] = useState<TokenListing | null>(null);
  const [newsFocus, setNewsFocus] = useState<StoryCard | null>(null);
  const openNewsOn = (listing: TokenListing, focus?: StoryCard) => {
    setNewsFilter(listing);
    setNewsFocus(focus ?? null);
    setDrawer("news");
  };
  const cashScene = scene === "cash";
  const cash = held ? parseUnits("2", CASH_LISTING.decimals) : cashScene ? parseUnits("20", CASH_LISTING.decimals) : 0n;
  const cashUsd = held ? 2.01 : cashScene ? 20.1 : undefined;
  const holdingsUsd = rows.reduce((sum, row) => sum + (row.worth ?? 0), 0);
  const funds = fundsFixture(held, scene === "empty" || cashScene);
  const copy = useCopy();
  const heldMap = new Map(rows.map((row) => [row.listing.address, row.balance]));
  const noop = () => {};

  const owned = (
    <Panel key="owned">
      <HoldingsView
        rows={rows}
        loading={false}
        pricesLoading={false}
        total={holdingsUsd + (cashUsd ?? 0)}
        includesCash={cash > 0n}
        onSell={noop}
        inviteCode={share ? "harbour7" : null}
        shareOpen={share === "open"}
      />
    </Panel>
  );
  const stage: HomeStage = scene === "empty" || cashScene ? "empty" : held ? "owns" : "funded";
  const money = (
    <Panel key="money" className="divide-y divide-border [&:not(:has(>:not(.hidden)))]:hidden">
      {mounted && <FundsModule onTopUp={noop} demo={{ embedded: funds, signedIn: true }} quietWhenEmpty={stage === "empty"} />}
      {(stage !== "empty" || cash > 0n) && (
        <CashShelfView parked={cash} parkedUsd={cashUsd} loading={false} ratePct={3.93} onPark={noop} onTakeOut={noop} />
      )}
    </Panel>
  );

  const said = NUDGES_SAID_BY_STEP[stage];

  return (
    <QueryClientProvider client={client}>
      {/* The dev overlays sit over the dock; the gallery is for looking at it. */}
      <style>{`[data-wallet-diagnostics], nextjs-portal { display: none !important; }`}</style>
      <div className={cn(BOARD_PAGE, dock && DOCK_CLEARANCE)}>
        <HomeHeader>
          <RankChip onClick={noop} presence />
        </HomeHeader>
        <HomeTracks
          stage={stage}
          banner={<NotHereBanner />}
          total={
            <AccountTotalView
              figures={{ holdings: holdingsUsd, cash: cashUsd ?? 0, funds: funds.totalUsd ?? 0, holdsAnything: rows.length > 0 }}
            />
          }
          owned={owned}
          buy={<BuyMoreButton onOpen={noop} />}
          next={
            stage === "empty" ? (
              <AddMoneyStep walletAccount={false} onAddMoney={noop} onBrowse={noop} aside={cashScene ? { kind: "cash" } : undefined} />
            ) : (
              <FirstBuyStep readyUsd={funds.totalUsd} onBuy={noop} onBrowse={noop} onAsk={look ? noop : undefined} onReadNews={look ? openNewsOn : undefined} />
            )
          }
          strips={
            <>
            {campaign && <CampaignLineView line={campaignLine(campaign)} />}
            {firstOpen && nvidia ? (
              <FirstStockCard listing={nvidia} onAsk={noop} onReadNews={openNewsOn} onDismiss={() => setFirstOpen(false)} />
            ) : walletEmail ? (
              <EmailNudgeLineView show onOpen={noop} onDismiss={noop} />
            ) : (
              <NudgeLineView
                nudge={nudge && said.includes(nudge.kind) ? null : nudge}
                onDismiss={() => setNudge(null)}
                onAddFunds={noop}
                onParkCash={noop}
                onOpenAccount={noop}
              />
            )}
            </>
          }
          moneyAside={cash > 0n}
          money={money}
          ask={
            <div className="hidden lg:block">
              <AskCard onOpen={noop} />
            </div>
          }
          more={<HomeMore onBoard={() => setDrawer("board")} onNews={() => setDrawer("news")} onAi={noop} />}
        />
      </div>
      {/* The board and the news open as they do on the home: ?drawer=board or ?drawer=news. */}
      <SectionDrawer open={drawer === "board"} onOpenChange={(open) => setDrawer(open ? "board" : null)} title={copy.boardTitle} description={copy.calmHome.moreBoardSub}>
        <ListingBoard
          onBuy={noop}
          onSell={noop}
          held={heldMap}
          robinhoodHeld={robinhoodMap}
          expandAll
          {...socialProofFor(proof)}
          onFilterNews={(listing) => {
            setNewsFilter(listing);
            setDrawer("news");
          }}
          newsFilterSymbol={newsFilter?.symbol}
        />
      </SectionDrawer>
      <SectionDrawer open={drawer === "news"} onOpenChange={(open) => setDrawer(open ? "news" : null)} title={copy.newsTitle} description={copy.calmHome.moreNewsSub}>
        <NewsFeed filter={newsFilter} focus={newsFocus} onClearFilter={() => setNewsFilter(null)} />
      </SectionDrawer>
      {dock && <AskDock onOpen={noop} hidden={drawer !== null} busy={streaming} />}
    </QueryClientProvider>
  );
}
