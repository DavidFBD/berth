"use client";

import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { HomeHeader, HomeTracks, BOARD_PAGE } from "@/components/home";
import { AddMoneyStep, BuyMoreButton, FirstBuyStep } from "@/components/home-next-step";
import { HomeMore } from "@/components/home-more";
import { NotHereBanner, useAvailability } from "@/components/availability/availability";
import { AccountTotalView } from "@/components/board/account-total";
import { HoldingsView, NudgeLineView } from "@/components/board";
import { AskCard } from "@/components/chat/ask-surfaces";
import { RankChip } from "@/components/rewards-panel";
import { Panel } from "@/components/ui/panel";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { AccountDrawerScreens } from "@/components/account-drawer";
import { FirstPathProvider, HomePathCard, pathOnScreen, useDoneMoment, type FirstPathValue } from "@/components/first-path";
import { FIRST_LOOK_QUERY_KEY } from "@/hooks/use-first-look";
import { buyStepState, firstPath, isPathStep, withSkip, withoutSkip, NUDGES_SAID_BY_PATH, type PathFacts, type PathStep } from "@/lib/first-path";
import { FIRST_LOOK_SYMBOLS, type FirstLookResponse } from "@/lib/first-look";
import type { HomeStage } from "@/lib/home-stage";
import type { Nudge } from "@/lib/nudge";
import type { Profile } from "@/lib/profile-types";
import type { MySocial } from "@/lib/social-types";
import { XP_ACTIONS } from "@/lib/xp";
import { COPY } from "@/lib/copy";
import { toast } from "@/lib/toast";
import { seededPortfolioClient } from "../account/portfolio-gallery";
import { seedDrawer } from "../account/drawer-gallery";
import { CampaignLineView } from "@/components/board/campaign-line";
import { campaignLine, type CampaignProgress } from "@/lib/campaigns";

/**
 * Dev-only: a brand new fixture account walking the guided first path
 * (lib/first-path) on the home and in the account drawer, with nothing
 * real behind it. Every step is live: saving the avatar, the username,
 * "adding money" (the money arrives at once), the first buy (it fills at
 * once), sharing the friend link, and Done on "You're set up".
 *
 *   /dev/board?home=path                 a new email account, at step 1
 *   &account=wallet                      a wallet account without an email
 *   &country=US                          where Berth cannot take an order
 *   &at=username|money|firstBuy|invite|complete
 *                                        start with the steps before it done
 *   &skipped=avatar,username             start with those set aside
 *   &drawer=1                            the account drawer open on it
 *   &done=avatar                         hold that step's Done moment
 *   &campaign=rules                      a campaign's line under the card
 */
export type PathGalleryProps = {
  account: "email" | "wallet";
  at: string | null;
  skipped: string | null;
  drawer: boolean;
  done: string | null;
  /** `&campaign=rules` (or holding, qualified, paid): the campaign line under the path's card, from /dev/campaigns' fixtures. */
  campaign?: CampaignProgress;
};

const ORDER: readonly (keyof PathFacts)[] = ["avatarSet", "usernameSet", "funded", "firstBuy", "inviteSent"];
const AT: Record<string, number> = { avatar: 0, username: 1, money: 2, firstBuy: 3, invite: 4, complete: 5 };

function startFacts(account: "email" | "wallet", at: string | null): PathFacts {
  const upTo = AT[at ?? "avatar"] ?? 0;
  const facts: PathFacts = {
    avatarSet: false,
    usernameSet: false,
    hasEmail: account === "email",
    funded: false,
    firstBuy: false,
    inviteSent: false,
  };
  ORDER.slice(0, upTo).forEach((key) => {
    (facts as Record<string, boolean | undefined>)[key] = true;
  });
  return facts;
}

function firstLookFixture(): FirstLookResponse {
  return {
    judged: true,
    asOf: Date.now(),
    looks: Object.fromEntries(
      // NVIDIA in today's news, Apple in the news this past week, the others with no news line.
      FIRST_LOOK_SYMBOLS.map((symbol) => [
        symbol,
        symbol === "NVDA"
          ? { looked: true, inNews: true, inNewsWeek: true }
          : { looked: false, inNews: false, inNewsWeek: symbol === "AAPL" },
      ]),
    ),
  };
}

export function PathGallery({ account, at, skipped: skippedParam, drawer: drawerParam, done: doneParam, campaign }: PathGalleryProps) {
  const [facts, setFacts] = useState(() => startFacts(account, at));
  const [skipped, setSkipped] = useState<PathStep[]>(() => (skippedParam ?? "").split(",").filter(isPathStep));
  const [finished, setFinished] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(drawerParam);
  const [{ client, rows }] = useState(() => {
    const seeded = seededPortfolioClient("first-day", { xp: 25 });
    seedDrawer(seeded.client, "new");
    const start = startFacts(account, at);
    seeded.client.setQueryData<Profile>(["profile", null], (profile) => ({
      ...(profile as Profile),
      xp: start.avatarSet ? 50 : 25,
      avatarId: start.avatarSet ? "buoy" : null,
      hasEmail: account === "email",
    }));
    seeded.client.setQueryData<MySocial>(["social-me", null], (me) => ({
      ...(me as MySocial),
      hasEmail: account === "email",
      handle: start.usernameSet ? "gosia" : null,
    }));
    seeded.client.setQueryData(FIRST_LOOK_QUERY_KEY, firstLookFixture());
    return seeded;
  });
  const availability = useAvailability();
  const canBuy = availability.available;
  const view = firstPath({ facts, record: { eligible: true, skipped, finished }, context: { account, canBuy } });
  const moment = useDoneMoment(view);
  const held = isPathStep(doneParam) ? doneParam : null;

  const set = (next: Partial<PathFacts>) => setFacts((previous) => ({ ...previous, ...next }));
  const xpOf = () => client.getQueryData<Profile>(["profile", null])?.xp ?? 25;
  const pay = (kind: "avatar_set" | "pour_in", amount: number) => {
    const xp = xpOf() + amount;
    client.setQueryData<Profile>(["profile", null], (profile) => ({ ...(profile as Profile), xp }));
    toast.rewards([{ kind, amount }], xp);
  };
  const unskip = (step: PathStep) => setSkipped((list) => withoutSkip(list, step));

  const value: FirstPathValue = {
    view,
    facts,
    referred: false,
    account,
    canBuy,
    done: held ?? moment,
    buy: buyStepState({ everFunded: facts.funded, stage: facts.firstBuy ? "owns" : facts.funded ? "funded" : "empty", liveStage: facts.firstBuy ? "owns" : facts.funded ? "funded" : "empty" }),
    skip: (step) => {
      setSkipped((list) => withSkip(list, step));
      toast(COPY.firstPath.skipped, { id: "first-path-skip", action: { label: COPY.firstPath.undo, onClick: () => unskip(step) } });
    },
    unskip,
    finish: () => setFinished(true),
    shared: () => set({ inviteSent: true }),
    invitedHow: "copied",
    demo: {
      saveAvatar: (avatarId) => {
        client.setQueryData<Profile>(["profile", null], (profile) => ({ ...(profile as Profile), avatarId }));
        pay("avatar_set", XP_ACTIONS.avatar_set.amount);
        set({ avatarSet: true });
      },
      saveName: (name) => {
        client.setQueryData<MySocial>(["social-me", null], (me) => ({ ...(me as MySocial), handle: name }));
        set({ usernameSet: true });
      },
      // The gallery has no share sheet: the link is copied, and the Done moment says so.
      share: () => set({ inviteSent: true }),
    },
    go: {
      money: () => {
        setDrawerOpen(false);
        set({ funded: true });
      },
      firstBuy: () => setDrawerOpen(false),
    },
  };
  const shown = pathOnScreen(value);
  const stage: HomeStage = facts.firstBuy ? "owns" : facts.funded ? "funded" : "empty";
  const noop = () => {};
  const addMoney = () => {
    toast.success(COPY.calmHome.addMoneyTitle);
    set({ funded: true });
  };
  const buy = () => {
    pay("pour_in", XP_ACTIONS.pour_in.amount);
    set({ firstBuy: true, funded: true });
  };
  const holdingsUsd = rows.reduce((sum, row) => sum + (row.worth ?? 0), 0);
  const nudge: Nudge | null = stage === "empty" ? { kind: "addFunds" } : stage === "funded" ? { kind: "firstBuy" } : null;

  return (
    <QueryClientProvider client={client}>
      <style>{`[data-wallet-diagnostics], nextjs-portal { display: none !important; }`}</style>
      <FirstPathProvider value={value}>
        <div className={BOARD_PAGE}>
          <HomeHeader>
            <RankChip onClick={() => setDrawerOpen(true)} presence />
          </HomeHeader>
          <HomeTracks
            stage={stage}
            banner={<NotHereBanner />}
            total={<AccountTotalView figures={{ holdings: holdingsUsd, cash: 0, funds: 0, holdsAnything: rows.length > 0 }} />}
            owned={
              <Panel key="owned">
                <HoldingsView rows={rows} loading={false} pricesLoading={false} total={holdingsUsd} includesCash={false} onSell={noop} />
              </Panel>
            }
            buy={<BuyMoreButton onOpen={noop} quiet={shown} />}
            path={{
              shown,
              waiting: false,
              card: (
                <HomePathCard
                  footnote={campaign ? <CampaignLineView line={campaignLine(campaign)} bare /> : null}
                  slots={{
                    money: (frame, title) => (
                      <AddMoneyStep walletAccount={account === "wallet"} onAddMoney={addMoney} onBrowse={addMoney} frame={frame} title={title} />
                    ),
                    firstBuy: (frame, title, note, state) => (
                      <FirstBuyStep readyUsd={25} unfunded={state.unfunded} loading={state.loading} onBuy={buy} onBrowse={noop} frame={frame} title={title} note={note} onReadNews={noop} />
                    ),
                  }}
                />
              ),
            }}
            next={
              stage === "empty" ? (
                <AddMoneyStep walletAccount={account === "wallet"} onAddMoney={addMoney} onBrowse={noop} />
              ) : (
                <FirstBuyStep readyUsd={25} onBuy={buy} onBrowse={noop} />
              )
            }
            strips={
              <NudgeLineView
                nudge={nudge && shown && NUDGES_SAID_BY_PATH.includes(nudge.kind) ? null : nudge}
                onDismiss={noop}
                onAddFunds={noop}
                onParkCash={noop}
                onOpenAccount={noop}
              />
            }
            money={null}
            ask={
              <div className="hidden lg:block">
                <AskCard onOpen={noop} />
              </div>
            }
            more={<HomeMore onBoard={noop} onNews={noop} onAi={noop} />}
          />
        </div>
        <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>{COPY.accountTotalLabel}</DrawerTitle>
              <DrawerDescription data-ph-mask>{account === "email" ? COPY.accountSignedInAs("gosia@example.com") : COPY.drawer.rows.wallets.sub}</DrawerDescription>
            </DrawerHeader>
            <AccountDrawerScreens kind={account} hasAddress onLeave={() => setDrawerOpen(false)} onSignOut={noop} />
          </DrawerContent>
        </Drawer>
      </FirstPathProvider>
    </QueryClientProvider>
  );
}
