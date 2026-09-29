"use client";

import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { parseUnits } from "viem";
import { HomeHeader, BOARD_GRID, BOARD_PAGE, BOARD_TRACK } from "@/components/home";
import { AccountTotalView } from "@/components/board/account-total";
import { CashShelfView } from "@/components/board/cash-shelf";
import { EmailNudgeLineView, HoldingsView, ListingBoard, NewsFeed, NudgeLineView } from "@/components/board";
import { FundsModule } from "@/components/funds-module";
import { AskCard, AskDock, DOCK_CLEARANCE } from "@/components/chat/ask-surfaces";
import { AssistantCard } from "@/components/assistant/assistant-card";
import { RankChip } from "@/components/rewards-panel";
import { Panel } from "@/components/ui/panel";
import type { EmbeddedHoldingsResult } from "@/hooks/use-embedded-holdings";
import { useMounted } from "@/hooks/use-mounted";
import { HOME_CHAIN } from "@/lib/account";
import { getDepositTokens } from "@/lib/chains";
import { CASH_LISTING, type TokenListing } from "@/lib/listings";
import type { Nudge } from "@/lib/nudge";
import { cn } from "@/lib/utils";
import { seededPortfolioClient } from "../account/portfolio-gallery";

/**
 * Dev-only: the signed-in board as Home composes it, from fixtures, so the
 * ledger layout can be reviewed (and shot) without a session.
 *
 *   /dev/board?home=held    three holdings, cash parked, funds waiting,
 *                           the comparison drawn from real closes
 *   /dev/board?home=new     a first visit: funds only, nothing held
 *   /dev/board?home=walletEmail
 *                           a wallet-only account (no verified email) after
 *                           its first buy: the email nudge strip in place of
 *                           the standing nudge line (lib/email-nudge)
 *
 * The prices, the board's lines and the news are live, from the same public
 * routes the app reads. Actions go nowhere. `&dock=0` hides the docked Ask;
 * `&streaming=1` shows it as it is while an answer comes in.
 */
export type HomeScene = "held" | "new" | "walletEmail";

function fundsFixture(held: boolean): EmbeddedHoldingsResult {
  const usdc = getDepositTokens(HOME_CHAIN).find((token) => token.symbol === "USDC");
  const holdings = usdc
    ? [{ chainKey: HOME_CHAIN, token: usdc, balance: parseUnits(held ? "2.40" : "25", usdc.decimals), usdValue: held ? 2.4 : 25 }]
    : [];
  return {
    emailMode: true,
    connected: true,
    isLoading: false,
    holdings,
    erroredChains: [],
    gasShortChains: [],
    totalUsd: held ? 2.4 : 25,
  };
}

export function HomeGallery({ scene, dock, streaming = false }: { scene: HomeScene; dock: boolean; streaming?: boolean }) {
  const walletEmail = scene === "walletEmail";
  const held = scene === "held" || walletEmail;
  const [{ client, rows }] = useState(() => seededPortfolioClient(held ? "three-months" : "empty", { xp: 900 }));
  const mounted = useMounted();
  const [nudge, setNudge] = useState<Nudge | null>(
    held
      ? { kind: "heldNews", symbol: "NVDA", name: "NVIDIA", postUrl: "https://x.com/nvidianewsroom" }
      : { kind: "firstBuy" },
  );
  const [newsFilter, setNewsFilter] = useState<TokenListing | null>(null);
  const cash = held ? parseUnits("2", CASH_LISTING.decimals) : 0n;
  const cashUsd = held ? 2.01 : undefined;
  const holdingsUsd = rows.reduce((sum, row) => sum + (row.worth ?? 0), 0);
  const funds = fundsFixture(held);
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
      />
    </Panel>
  );
  const money = (
    <Panel key="money" className="divide-y divide-border">
      {mounted && <FundsModule onTopUp={noop} demo={{ embedded: funds, signedIn: true }} />}
      <CashShelfView parked={cash} parkedUsd={cashUsd} loading={false} ratePct={3.93} onPark={noop} onTakeOut={noop} />
    </Panel>
  );

  return (
    <QueryClientProvider client={client}>
      {/* The dev overlays sit over the dock; the gallery is for looking at it. */}
      <style>{`[data-wallet-diagnostics], nextjs-portal { display: none !important; }`}</style>
      <div className={cn(BOARD_PAGE, dock && DOCK_CLEARANCE)}>
        <HomeHeader>
          <RankChip onClick={noop} presence />
        </HomeHeader>
        <div className={BOARD_GRID}>
          <div className={BOARD_TRACK}>
            <AccountTotalView
              figures={{ holdings: holdingsUsd, cash: cashUsd ?? 0, funds: funds.totalUsd, holdsAnything: rows.length > 0 }}
            />
            {walletEmail ? (
              <EmailNudgeLineView show onOpen={noop} onDismiss={noop} />
            ) : (
              <NudgeLineView
                nudge={nudge}
                onDismiss={() => setNudge(null)}
                onAddFunds={noop}
                onParkCash={noop}
                onOpenAccount={noop}
              />
            )}
            {held ? [owned, money] : [money, owned]}
            <ListingBoard
              onBuy={noop}
              onSell={noop}
              held={heldMap}
              onFilterNews={(listing) => setNewsFilter((current) => (current?.symbol === listing.symbol ? null : listing))}
              newsFilterSymbol={newsFilter?.symbol}
            />
          </div>
          <div className={BOARD_TRACK}>
            <div className="hidden lg:block">
              <AskCard onOpen={noop} />
            </div>
            <NewsFeed filter={newsFilter} onClearFilter={() => setNewsFilter(null)} collapsible />
            <AssistantCard onChoose={noop} />
          </div>
        </div>
      </div>
      {dock && <AskDock onOpen={noop} hidden={false} busy={streaming} />}
    </QueryClientProvider>
  );
}
