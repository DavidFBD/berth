"use client";

import { track, trackOnce } from "@/lib/analytics";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { LeverageYieldVault } from "@sodax/dapp-kit";
import { useQueryClient } from "@tanstack/react-query";
import { WalletDrawer } from "@/components/wallet";
import { AccountButton, AddMoneyDrawer, useAssistantReachable, useEmailSession } from "@/components/account-button";
import { BerthMark } from "@/components/berth-mark";
import { BetaPill } from "@/components/ui/beta-pill";
import { InfoDrawer } from "@/components/info-drawer";
import { CommandHint, CommandMenu } from "@/components/command-menu";
import { useCopy } from "@/components/settings-provider";
import {
  AccountTotal,
  CashShelf,
  EmailNudgeLine,
  FeedbackPromptLine,
  FirstFriendLine,
  PolicyNoticeLine,
  SocialNoticeLine,
  HoldingsList,
  ListingBoard,
  NewsFeed,
  NudgeLine,
  WaitingOrders,
  useLiveFigures,
  useWaitingOrdersShowing,
  CampaignLine,
} from "@/components/board";
import { AskCard, AskCardPlaceholder, AskDock, DOCK_CLEARANCE } from "@/components/chat/ask-surfaces";
import { useAskAvailable } from "@/components/chat/chat-status";
import { AssistantCard } from "@/components/assistant/assistant-card";
import type { AssistantId } from "@/lib/assistant-party";
import { cn } from "@/lib/utils";
import type { StoryCard } from "@/lib/news-stories";
import { FundsModule } from "@/components/funds-module";
import { Panel } from "@/components/ui/panel";
import { VaultPositions } from "@/components/vaults";
import { DepositDrawer, WithdrawDrawer } from "@/components/flow";
import { useHubAccount } from "@/hooks/use-hub-account";
import { useHubHoldings } from "@/hooks/use-hub-holdings";
import { useAccountHoldings } from "@/hooks/use-account-holdings";
import { FirstStockCard } from "@/components/first-look";
import { useEmbeddedHoldings } from "@/hooks/use-embedded-holdings";
import { AddMoneyStep, BuyMoreButton, FirstBuyStep, NextStepSkeleton } from "@/components/home-next-step";
import { HomeMore, SectionDrawer } from "@/components/home-more";
import { ADDRESS_WAIT_MS, hasMoneyAside, homeStage, parseHomeStage, NUDGES_SAID_BY_STEP, type HomeStage } from "@/lib/home-stage";
import { decideHomeStage, type LastKnownSnapshot } from "@/lib/last-known";
import { MIN_ORDER_USD } from "@/lib/order-minimum";
import { campaignLinePlace } from "@/lib/campaigns";
import { useLimitOrders } from "@/hooks/use-limit-orders";
import { useAccountWallets, useCloseFirstStock, useFirstStock, useLastKnown, useSaveLastKnown } from "@/hooks/use-profile";
import { useAddConnectedWallet, useUnlinkedWalletShowing } from "@/hooks/use-account-wallets";
import { UnlinkedWalletPrompt } from "@/components/account-wallets";
import { sellSources } from "@/lib/account-wallets";
import {
  ROBINHOOD_CHAIN_KEY,
  defaultSellSource,
  hubSellSources,
  robinhoodSellPaused,
  robinhoodSellSources,
  type SellSource,
} from "@/lib/robinhood-sell";
import { useRobinhoodGasReady, useRobinhoodSellBalances } from "@/hooks/use-robinhood-sell";
import { useDelivery } from "@/hooks/use-delivery";
import { parseUnits } from "viem";
import { useStoredChoice } from "@/hooks/use-stored-choice";
import { useUserVaultPosition } from "@/hooks/use-user-vault-position";
import { usePrivyEmbeddedWallet } from "@/hooks/use-privy-evm-wallet";
import { HOME_CHAIN } from "@/lib/account";
import {
  CASH_LISTING,
  rowName,
  vaultListing,
  type Listing,
  type TokenListing,
} from "@/lib/listings";
import { AuthGate } from "@/components/welcome-screen";
import { DraftLinkOpener, showDraftOpening } from "@/components/assistant/draft-link-opener";
import dynamic from "next/dynamic";
import { ChatButton } from "@/components/chat/chat-button";
import type { ChatDraft } from "@/components/chat/chat-parts";
import { draftOpening, type BuyPrefill, type SellPrefill } from "@/lib/draft-open";
import { useAccountHeaders } from "@/hooks/use-profile";
import { useTermsAcceptance } from "@/hooks/use-social";
import { confirmBuy, latchGate, termsGate, type TermsGate } from "@/lib/terms-gate";
import { TermsSheet } from "@/components/terms-sheet";
import { NoAccountHere, NotHereBanner, useAvailability } from "@/components/availability/availability";
import { useUnavailableRefused } from "@/lib/unavailable-refusal";
import { FirstPathProvider, HomePathCard, pathOnScreen, useLiveFirstPath } from "@/components/first-path";
import { FundingProvider } from "@/components/funding-handoff";
import { useFundingHandoff } from "@/hooks/use-funding-handoff";
import { FUND_USDC_BASE, handoffTarget, keepsTopUp, preferPayLeftMs, type PreferPay } from "@/lib/funding-handoff";
import { toast } from "@/lib/toast";
import { ChainKeys } from "@sodax/sdk";
import { NUDGES_SAID_BY_PATH, buyStepState, pathPlace } from "@/lib/first-path";

/** The board's frame, shared with the dev gallery (/dev/board?home=…) so the two cannot drift. */
export const BOARD_PAGE = "mx-auto flex w-full max-w-lg flex-col px-4 pb-12 lg:max-w-[80rem] lg:px-10";
export const BOARD_GRID =
  "flex flex-col gap-3 lg:grid lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start lg:gap-5";
export const BOARD_TRACK = "flex min-w-0 flex-col gap-3 lg:gap-4";

const ChatHost = dynamic(() => import("@/components/chat/chat-sheet"), { ssr: false });

/**
 * The one screen: what the account is worth beside a benchmark, what it
 * owns, the funds that can pay and the cash shelf, the board of stocks and
 * funds, any earlier vault positions still to be withdrawn, then Ask, the
 * news and the assistant. Every order opens a drawer over it.
 */
export function Home() {
  // Everything that reads the account (the funds sweep included, which
  // cannot run before the wallet services exist) lives past the gate.
  return (
    <AuthGate>
      <SignedInHome />
    </AuthGate>
  );
}

function SignedInHome() {
  // The buy drawer pours into a listing: a stock or fund from the board, or
  // cash. Vault deposits are no longer offered, so no vault reaches it.
  const [buyListing, setBuyListing] = useState<Listing | null>(null);
  const [buyOpen, setBuyOpen] = useState(false);
  const [sellListing, setSellListing] = useState<TokenListing | null>(null);
  const [sellOpen, setSellOpen] = useState(false);
  // An amount from an assistant's draft (DraftLinkOpener), for the next
  // opening only; any other way of opening a drawer starts empty.
  const [buyPrefill, setBuyPrefill] = useState<BuyPrefill | null>(null);
  const [sellPrefill, setSellPrefill] = useState<SellPrefill | null>(null);
  const [withdrawVault, setWithdrawVault] =
    useState<LeverageYieldVault | null>(null);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  // Which listing the news column is pointed at, if any. Lives here because
  // the board sets it and the news reads it; neither owns the other.
  const [newsFilter, setNewsFilter] = useState<TokenListing | null>(null);
  const [walletOpen, setWalletOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  // Ask, the in-app assistant. A draft opened from it closes the sheet for
  // the order drawer and reopens it once that drawer closes.
  const [chatOpen, setChatOpen] = useState(false);
  // Whether an answer is streaming in the chat, so the phone's dock can say so.
  const [chatBusy, setChatBusy] = useState(false);
  // Loaded on first open, then kept, so the conversation outlives the sheet.
  const [chatLoaded, setChatLoaded] = useState(false);
  // A suggestion tapped on the board, sent once the sheet has the chat's status.
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const takePending = useCallback(() => setPendingPrompt(null), []);
  const openChat = (prompt?: string) => {
    setChatLoaded(true);
    setPendingPrompt(prompt ?? null);
    setChatOpen(true);
  };
  const askAvailable = useAskAvailable();
  const assistantReachable = useAssistantReachable();
  // Which assistant the board's "Your assistant" card opened the drawer on.
  const [accountAssistant, setAccountAssistant] = useState<AssistantId | null>(null);
  // Whether the email nudge opened the drawer, so it lands on the add-email row.
  const [focusEmail, setFocusEmail] = useState(false);
  // Whether the social notice opened the drawer, so it lands on the profile screen.
  const [focusFriends, setFocusFriends] = useState(false);
  const openAccount = (assistant: AssistantId | null = null) => {
    setAccountAssistant(assistant);
    setAccountOpen(true);
  };
  // A wallet account adds money to its own wallet: the account drawer, on that screen.
  const [focusMoney, setFocusMoney] = useState(false);
  const openAccountForMoney = () => {
    setFocusMoney(true);
    setAccountOpen(true);
  };
  const openAccountForFriends = () => {
    setFocusFriends(true);
    setAccountOpen(true);
  };
  const openAccountForEmail = () => {
    setFocusEmail(true);
    setAccountOpen(true);
  };
  const onAccountOpenChange = (next: boolean) => {
    setAccountOpen(next);
    if (!next) {
      setAccountAssistant(null);
      setFocusEmail(false);
      setFocusFriends(false);
      setFocusMoney(false);
    }
  };
  // Whether a higher-priority strip already holds the email nudge's slot.
  const waitingOrdersShowing = useWaitingOrdersShowing();
  // The email strip says whether it shows, so the feedback ask waits behind it.
  const [emailNudgeShowing, setEmailNudgeShowing] = useState(false);
  const unlinkedWalletShowing = useUnlinkedWalletShowing(accountOpen);
  const hasAccount = useAccountHeaders({ prompt: false }).key !== null;
  const [chatReturn, setChatReturn] = useState(false);
  const privy = usePrivyEmbeddedWallet();
  const copy = useCopy();
  // Where the account stands decides the home's one next step
  // (lib/home-stage): add money, buy the first stock, or, once it owns
  // something, its total and holdings lead and Buy follows.
  const account = useHubAccount();
  const holdings = useHubHoldings(account.hubWallets);
  // Both chains decide the step and the first stock (plan P1a): an
  // account's first buy may sit in its own wallet on Robinhood Chain. A
  // draft sell still reads `holdings`, the hub, which is all a sell spends.
  const ownedHoldings = useAccountHoldings(account, holdings);
  const funds = useEmbeddedHoldings();
  // The answer is remembered per account, so a returning holder's page
  // opens in its settled order instead of reordering when holdings land.
  // Keyed by the account's home, not by where this session's buys land
  // (the signer's own wallet), so every wallet of one account shares it.
  const accountKey = account.wallets.find((wallet) => wallet.isHome)?.spoke ?? account.spokeAddress;
  const [rememberedStage, rememberStage] = useStoredChoice(
    accountKey ? `berth.home-stage.${accountKey.toLowerCase()}` : null,
  );
  // Before 2026-10-01 only "owns something" was remembered; read it once.
  const [rememberedOwns] = useStoredChoice(
    accountKey ? `berth.owns-listings.${accountKey.toLowerCase()}` : null,
  );
  // Holdings count as read only once the linked wallets are known: until
  // then an email session reads its own wallet alone, and stocks held on a
  // linked wallet would read as none.
  const linkedWallets = useAccountWallets();
  // A missing wallet address may hold the step for a bounded wait, no longer.
  const [waitedOut, setWaitedOut] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setWaitedOut(true), ADDRESS_WAIT_MS);
    return () => clearTimeout(timer);
  }, []);
  // Unknown is unknown, never $0 (lib/home-stage). A proven stage is shown
  // and remembered; a provisional one (only failed or missing networks
  // stand between it and certainty) is shown when nothing is remembered,
  // and never remembered itself.
  const live = homeStage({
    holdingsSettled: ownedHoldings.settled && !linkedWallets.isLoading,
    ownsStock: ownedHoldings.held.some((holding) => holding.listing.kind === "stock"),
    funds: {
      connected: funds.connected,
      unaddressedChains: funds.unaddressedChains.length,
      isLoading: funds.isLoading,
      erroredChains: funds.erroredChains.length,
      holdings: funds.holdings,
      totalUsd: funds.totalUsd,
    },
    waitedOut,
  });
  const proven = live.proven ? live.stage : undefined;
  const remembered = parseHomeStage(rememberedStage) ?? (rememberedOwns === "1" ? "owns" : undefined);
  // The account's last reading (lib/last-known), from the server: the page
  // opens in the order it had on any device, its figures marked as
  // updating, while the live reads arrive. A proven live stage always wins.
  const lastKnown = useLastKnown(Boolean(accountKey));
  const decided: HomeStage | undefined = decideHomeStage({ live, remembered, lastKnown: lastKnown.data }).stage;
  // Once every part was read live, keep it as the account's last known.
  const liveFigures = useLiveFigures();
  const liveSnapshot: LastKnownSnapshot | undefined =
    proven && liveFigures.complete && liveFigures.held
      ? {
          v: 1,
          stage: proven,
          stocks: liveFigures.figures.holdings ?? null,
          cash: liveFigures.figures.cash ?? null,
          // Kept only when whole: short of a network, the funds are unknown, not the sum read.
          funds: liveFigures.fundsWhole ? (liveFigures.figures.funds ?? null) : null,
          waiting: liveFigures.figures.waiting ?? null,
          holdings: liveFigures.held,
        }
      : undefined;
  useSaveLastKnown(liveSnapshot);
  useEffect(() => {
    if (proven !== undefined && rememberedStage !== proven) rememberStage(proven);
  }, [proven, rememberedStage, rememberStage]);
  const holdsCash = holdings.held.some((holding) => holding.listing.kind === "cash");
  // The first stock's card (components/first-look, lib/first-stock): while
  // the account holds exactly one stock, for two weeks from its first buy,
  // until "Got it" closes it on the account. This browser remembers the
  // close too, so the card never flashes back while the server is asked.
  const [firstStockClosed, rememberFirstStockClosed] = useStoredChoice(
    accountKey ? `berth.first-stock-closed.${accountKey.toLowerCase()}` : null,
  );
  const stocksHeld = ownedHoldings.held.filter((holding) => holding.listing.kind === "stock");
  // The first stock's card says where it is: the Berth account, or, for a
  // stock delivered to Robinhood Chain, the person's own wallet there. A
  // first stock split between the two has no one true line, so no card.
  const firstHeld = stocksHeld.length === 1 ? stocksHeld[0] : undefined;
  const firstInWallet = firstHeld !== undefined && firstHeld.robinhood > 0n && firstHeld.robinhood >= firstHeld.balance;
  // A first stock part of which came back from a sell there has no one true line either.
  const oneStock =
    proven === "owns" &&
    ownedHoldings.settled &&
    firstHeld !== undefined &&
    firstHeld.returned === 0n &&
    (firstHeld.robinhood === 0n || firstInWallet);
  const firstStockState = useFirstStock(oneStock);
  const closeFirstStock = useCloseFirstStock();
  const firstStock =
    oneStock && firstStockClosed !== "1" && firstStockState.data?.show === true
      ? (stocksHeld[0].listing as TokenListing)
      : null;
  // Closed here but the save never landed (offline through every retry):
  // say it again, so the other devices learn it too.
  const closeSaved = firstStockState.data?.closed;
  const closeFirstStockMutate = closeFirstStock.mutate;
  const closePending = closeFirstStock.isPending;
  const closeResent = useRef(false);
  useEffect(() => {
    if (closeResent.current || firstStockClosed !== "1" || closeSaved !== false || closePending) return;
    closeResent.current = true; // once a visit, so a server that keeps refusing is not asked in a loop
    closeFirstStockMutate();
  }, [firstStockClosed, closeSaved, closePending, closeFirstStockMutate]);
  // Earlier vault positions (components/vaults), reported by the section
  // itself: a vault holder's step says what the position is worth.
  const [vaults, setVaults] = useState<{ present: boolean; usd: number | undefined }>({ present: false, usd: undefined });
  // Cash parked or dollars waiting in a limit order: before a first stock,
  // the total still shows, so that money is never hidden behind Add money.
  const limitOrders = useLimitOrders({ poll: false });
  const waitingOrders = limitOrders.waiting.length > 0;
  const moneyAside = hasMoneyAside({ holdsCash, waitingOrders });
  // Before a first stock, the step waits for the waiting-orders read too,
  // so the total never lands above it after it has been placed.
  const stage: HomeStage | undefined = decided !== "owns" && limitOrders.isLoading ? undefined : decided;
  useEffect(() => {
    if (stage) trackOnce(`home-stage:${stage}`, "home_stage_shown", { stage });
  }, [stage]);

  // What sits one tap away (components/home-more), and the add-money drawer.
  const [boardOpen, setBoardOpen] = useState(false);
  const [newsOpen, setNewsOpen] = useState(false);
  // The first look's headline, or its "More news": the news drawer, pointed
  // at that listing, with the headline tapped shown first.
  const [newsFocus, setNewsFocus] = useState<StoryCard | null>(null);
  const openNewsOn = (listing: TokenListing, focus?: StoryCard) => {
    setNewsFilter(listing);
    setNewsFocus(focus ?? null);
    setNewsOpen(true);
  };
  const [aiOpen, setAiOpen] = useState(false);
  const [addMoneyOpen, setAddMoneyOpen] = useState(false);
  // Decided from the session, not from whether the embedded wallet exists
  // yet: the drawer says the account is being opened until it does.
  const emailSession = useEmailSession();
  // The guided first path (lib/first-path): one view for the home's step,
  // the drawer's Next step and the nudge line. What the home proves about
  // money and holdings are its facts; the rest it reads for itself.
  const pageAvailability = useAvailability();
  const holdingsKnown = holdings.settled && !linkedWallets.isLoading;
  const livePath = useLiveFirstPath({
    funded: decided === undefined ? undefined : decided !== "empty",
    ownsStock: holdingsKnown ? ownedHoldings.held.some((holding) => holding.listing.kind === "stock") : undefined,
    account: emailSession ? "email" : "wallet",
    canBuy: pageAvailability.available,
    accountKey: accountKey ?? null,
  });
  // An email account adds money in its own small drawer; a wallet account's
  // money lives in its wallet, so it keeps the account drawer as before.
  const openAddMoney = () => {
    if (emailSession) showAddMoney();
    else openAccountForMoney();
  };
  // A buy or sell opened from the board drawer brings the board back when it closes.
  const [boardReturn, setBoardReturn] = useState(false);
  // From adding money to the buy (lib/funding-handoff): a card payment that
  // went through is watched until its USDC lands on Base, then the order
  // that asked for it reopens paying with it, or the person chooses one.
  const handoff = useFundingHandoff();
  // The buy that sent the person to add money, when one did.
  const [topUpFor, setTopUpFor] = useState<Listing | null>(null);
  // Money that just arrived, for the next buy's "paying with" slot.
  const [preferPay, setPreferPay] = useState<PreferPay | null>(null);
  // Offered first for a while only: an offer nobody took lapses, and the sweep picks again.
  useEffect(() => {
    if (!preferPay) return;
    const timer = setTimeout(() => setPreferPay(null), preferPayLeftMs(preferPay, Date.now()));
    return () => clearTimeout(timer);
  }, [preferPay]);
  // The ways to pay, unless money is still on its way (then the wait shows): a wait that settled is let go first.
  const showAddMoney = () => {
    if (handoff.view?.kind !== "waiting") {
      if (handoff.view) handoff.end();
      // Opened afresh: no order is waiting on this money (a top up sets its own just after).
      setTopUpFor(null);
    }
    setAddMoneyOpen(true);
  };

  // Email login is the primary path; the external wallet drawer is the
  // fallback for signed-in users reaching for a non-EVM source chain.
  const openWallet = () => {
    if (privy.enabled && !privy.authenticated) {
      privy.login();
      return;
    }
    setWalletOpen(true);
  };

  const openBuy = (listing: Listing) => {
    setChatReturn(false);
    setBoardReturn(false);
    setBuyPrefill(null);
    setBuyListing(listing);
    setBuyOpen(true);
  };
  const openSell = (listing: TokenListing) => {
    setChatReturn(false);
    setBoardReturn(false);
    setSellPrefill(null);
    setSellListing(listing);
    setSellOpen(true);
  };
  const openDraftBuy = useCallback((listing: TokenListing, prefill: BuyPrefill) => {
    setBuyPrefill(prefill);
    setBuyListing(listing);
    setBuyOpen(true);
  }, []);
  const openDraftSell = useCallback((listing: TokenListing, prefill: SellPrefill) => {
    setSellPrefill(prefill);
    setSellListing(listing);
    setSellOpen(true);
  }, []);

  const openChatDraft = (draft: ChatDraft) => {
    const opening = draftOpening(
      {
        symbol: draft.symbol,
        side: draft.side,
        usd: draft.usd,
        quantity: draft.quantity,
        limitPrice: draft.limitPrice,
        expires: draft.expires,
      },
      // Either place a sell can come from (plan P3a): the Berth account or the wallet on Robinhood Chain.
      {
        settled: ownedHoldings.settled && ownedHoldings.robinhoodState !== "loading",
        // Only what a sell can spend: never what came back from a sell there (lib/robinhood-returned).
        heldAddresses: ownedHoldings.held.filter((holding) => holding.sellable > 0n).map((holding) => holding.listing.address),
      },
    );
    if (opening.kind === "buy" || opening.kind === "sell") {
      setChatOpen(false);
      setChatReturn(true);
    }
    showDraftOpening(opening, copy, { onBuy: openDraftBuy, onSell: openDraftSell });
  };
  // Closing an order drawer a chat draft opened brings the chat back.
  const returnToChat = () => {
    if (!chatReturn) return;
    setChatReturn(false);
    setChatOpen(true);
  };
  const returnToBoard = () => {
    if (!boardReturn) return;
    setBoardReturn(false);
    setBoardOpen(true);
  };
  // The terms, asked once per version before a buy or a sell (lib/terms-gate):
  // a buy waits for Accept, a sell may go on without it. Where buying is
  // not offered the buy drawer says so itself, so it is not asked there.
  const terms = useTermsAcceptance();
  const [sellSkippedTerms, setSellSkippedTerms] = useState(false);
  // Decided once per opening (lib/terms-gate latchGate): what an opening
  // showed is kept in state, so an answer that lands later never closes an
  // order drawer that is already open.
  const [buyLatch, setBuyLatch] = useState<TermsGate | null>(null);
  const [sellLatch, setSellLatch] = useState<TermsGate | null>(null);
  const buyGate = buyOpen ? latchGate(buyLatch, pageAvailability.available ? termsGate("buy", terms.state, sellSkippedTerms) : "drawer") : null;
  const sellGate = sellOpen ? latchGate(sellLatch, termsGate("sell", terms.state, sellSkippedTerms)) : null;
  if (buyGate !== buyLatch) setBuyLatch(buyGate);
  if (sellGate !== sellLatch) setSellLatch(sellGate);
  // A sell opened before the answer came counts as let through for the visit.
  if (sellGate === "drawer" && sellLatch === null && terms.state === "loading" && !sellSkippedTerms) setSellSkippedTerms(true);
  // The campaign line's "Accept the terms" (lib/server/campaigns/eligibility rule 3): only while no order asks first.
  const [campaignTermsOpen, setCampaignTermsOpen] = useState(false);
  const queryClient = useQueryClient();
  const termsSheetFor = buyGate === "sheet" || buyGate === "wait" ? "buy" : sellGate === "sheet" ? "sell" : campaignTermsOpen ? "campaign" : null;
  // The last check, when a buy is confirmed inside an open drawer (someone
  // who signed in there was never asked): the sheet opens over the drawer,
  // and Accept goes on with the same order. A sell never asks.
  const [confirmAsk, setConfirmAsk] = useState(false);
  const confirmAnswer = useRef<((accepted: boolean) => void) | null>(null);
  const answerConfirm = (accepted: boolean) => {
    confirmAnswer.current?.(accepted);
    confirmAnswer.current = null;
    setConfirmAsk(false);
  };
  const confirmTerms = () =>
    confirmBuy({
      check: terms.check,
      ask: () =>
        new Promise<boolean>((resolve) => {
          confirmAnswer.current = resolve;
          setConfirmAsk(true);
        }),
    });
  const onBuyOpenChange = (next: boolean) => {
    setBuyOpen(next);
    if (!next) {
      // The arrived money was offered once; the sweep picks from here on.
      setPreferPay(null);
      // A buy closed while the last check asks: the order is not placed.
      if (confirmAnswer.current) answerConfirm(false);
      returnToChat();
      returnToBoard();
    }
  };
  const onSellOpenChange = (next: boolean) => {
    setSellOpen(next);
    if (!next) {
      returnToChat();
      returnToBoard();
    }
  };

  const [commandOpen, setCommandOpen] = useState(false);
  const anyDrawerOpen =
    chatOpen || buyOpen || sellOpen || withdrawOpen || walletOpen || accountOpen ||
    boardOpen || newsOpen || aiOpen || addMoneyOpen;

  // Funds, Cash and any earlier vault position, in every stage. Before
  // there is money the Funds row draws only what it has to say (an asset
  // under the minimum, a network it could not read, a gas shortfall), the
  // Cash row only once cash is parked, and an empty panel not at all.
  const empty = stage === "empty";
  const money = (
    <Panel key="money" data-ph-mask className="divide-y divide-border [&:not(:has(>:not(.hidden)))]:hidden">
      <FundsModule onTopUp={openAddMoney} quietWhenEmpty={empty} />
      {(!empty || holdsCash) && (
        <CashShelf
          onPark={() => openBuy(CASH_LISTING)}
          onTakeOut={() => openSell(CASH_LISTING)}
        />
      )}
      <VaultPositions
        onWithdraw={(vault) => {
          setWithdrawVault(vault);
          setWithdrawOpen(true);
        }}
        onHeld={setVaults}
      />
    </Panel>
  );
  const owned = (
    <Panel key="owned">
      <HoldingsList onSell={openSell} />
    </Panel>
  );
  const openBoard = () => setBoardOpen(true);
  const path = {
    ...livePath,
    buy: buyStepState({ everFunded: livePath.facts.funded, stage, liveStage: live.stage }),
    go: {
      // From the drawer's Next step to the home's own: the drawer closes first.
      money: () => {
        onAccountOpenChange(false);
        if (emailSession) showAddMoney();
        else openBoard();
      },
      firstBuy: () => onAccountOpenChange(false),
    },
  };
  const pathShown = pathOnScreen(path);
  const pathWaiting = path.view.kind === "wait";
  const campaignPlace = campaignLinePlace({
    pathOnScreen: pathShown || pathWaiting,
    stageKnown: stage !== undefined,
    holdingsSettled: holdings.settled,
  });
  const spendable = funds.totalUsd !== undefined && funds.totalUsd >= MIN_ORDER_USD ? funds.totalUsd : undefined;

  // The card payment went through: the wait shows in the Add money drawer,
  // wherever the payment began (the account drawer closes for it).
  const onFunded = (watch: Parameters<typeof handoff.begin>[0]) => {
    // A payment begun outside Add money is not for the order that once opened it.
    if (!keepsTopUp({ kind: "funded", fromAddMoney: addMoneyOpen })) setTopUpFor(null);
    // Money from an earlier arrival is no longer the one to offer first.
    setPreferPay(null);
    handoff.begin(watch);
    onAccountOpenChange(false);
    setAddMoneyOpen(true);
  };
  const handoffTo = handoffTarget({ hasListing: topUpFor !== null, canBuy: pageAvailability.available });
  const topUpName = topUpFor && topUpFor.kind !== "vault" ? rowName(topUpFor) : undefined;
  // Once the money lands: the next buy pays with it, and the order that
  // asked for it reopens. With the drawer closed meanwhile, a toast offers
  // the same way on rather than a drawer opening over whatever is in hand.
  const arrived = handoff.view?.kind === "arrived";
  const handedOff = useRef<number | null>(null);
  // On the path its first buy card is the next thing on the home; otherwise every stock and fund.
  const showChoice = () => {
    if (path.view.kind === "step" && path.view.step === "firstBuy") window.scrollTo({ top: 0, behavior: "smooth" });
    else openBoard();
  };
  useEffect(() => {
    const watch = handoff.watch;
    if (!arrived || !watch || handedOff.current === watch.startedAt) return;
    const settle = () => {
      handedOff.current = watch.startedAt;
      track("add_money_arrived", { handoff: handoffTo });
    };
    if (handoffTo === "none") return settle();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the arrival is only known from a chain read
    setPreferPay({ chainKey: ChainKeys.BASE_MAINNET, address: FUND_USDC_BASE, since: Date.now() });
    if (handoffTo === "choose") {
      settle();
      // Closed while it was on its way: one quiet way on, in a toast.
      if (!addMoneyOpen) {
        handoff.end();
        toast.success(copy.funding.arrivedTitle, { id: "funding-arrived", action: { label: copy.funding.arrivedChoose, onClick: showChoice } });
      }
      return;
    }
    if (!topUpFor) return settle();
    const listing = topUpFor;
    const name = listing.kind !== "vault" ? rowName(listing) : copy.calmHome.buyAction;
    if (addMoneyOpen) {
      // A beat on the arrival line, then the order it was added for.
      const timer = setTimeout(() => {
        settle();
        setAddMoneyOpen(false);
        handoff.end();
        setTopUpFor(null);
        openBuy(listing);
      }, 1_600);
      return () => clearTimeout(timer);
    }
    // Closed meanwhile: a toast offers the order rather than a drawer opening over whatever is in hand.
    settle();
    handoff.end();
    setTopUpFor(null);
    toast.success(copy.funding.arrivedTitle, {
      id: "funding-arrived",
      action: { label: copy.calmHome.firstBuy(name), onClick: () => openBuy(listing) },
    });
    // Once per watch: openBuy, showChoice and the copy are read as they stand when it lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrived, handoff.watch, handoffTo, topUpFor, addMoneyOpen]);
  const chooseAfterArrival = () => {
    setAddMoneyOpen(false);
    handoff.end();
    showChoice();
  };
  // A card payment that failed with the provider must not hold the person on the wait:
  // the ways to pay come back, and the order that asked for money still follows them.
  const payAnotherWay = () => {
    handoff.end();
    if (!keepsTopUp({ kind: "payAnotherWay" })) setTopUpFor(null);
  };
  const onAddMoneyOpenChange = (next: boolean) => {
    setAddMoneyOpen(next);
    // Closed with nothing on its way (paid with crypto, or not at all): the order that opened it is let go.
    if (!next && !keepsTopUp({ kind: "addMoneyClosed", watching: handoff.view?.kind === "waiting" || handoff.view?.kind === "arrived" })) setTopUpFor(null);
    // Closed on a stopped wait, or on an arrival with no order to reopen:
    // nothing more to watch. While waiting, it goes on, and an order that
    // asked for the money is still offered once it lands.
    if (!next && handoff.view && (handoff.view.kind === "stopped" || handoff.view.kind === "unknown" || (handoff.view.kind === "arrived" && handoffTo !== "buy"))) {
      handoff.end();
      setTopUpFor(null);
    }
  };

  // Where Berth is not available, a sign in the server made no account
  // for (lib/server/availability) says so instead of an empty board.
  const availability = pageAvailability;
  const noAccountHere = useUnavailableRefused("/api/profile");

  return (
    <FirstPathProvider value={path}>
      <FundingProvider onFunded={onFunded}>
      {noAccountHere ? (
        <NoAccountHere availability={availability} />
      ) : (
      <>
      <div className={cn(BOARD_PAGE, askAvailable !== false && DOCK_CLEARANCE)}>
        <HomeHeader onOpenChat={askAvailable === false ? () => openChat() : undefined} onOpenCommandMenu={() => setCommandOpen(true)}>
          <AccountButton
            open={accountOpen}
            onOpenChange={onAccountOpenChange}
            assistant={accountAssistant}
            focusEmail={focusEmail}
            focusFriends={focusFriends}
            focusMoney={focusMoney}
          />
        </HomeHeader>

        <HomeTracks
          stage={stage}
          banner={<NotHereBanner />}
          total={<AccountTotal />}
          owned={owned}
          buy={<BuyMoreButton onOpen={openBoard} quiet={pathShown} />}
          path={{
            shown: pathShown,
            waiting: pathWaiting,
            card: (
              <HomePathCard
                // No campaign line under the path's cards: the path carries the first buy step, and a
                // campaign's reward never stands beside a buy. It shows quietly in the second track meanwhile
                // (lib/campaigns campaignLinePlace).
                footnote={null}
                slots={{
                  money: (frame, title) => (
                    <AddMoneyStep
                      walletAccount={!emailSession}
                      onAddMoney={openAddMoney}
                      cardAddress={emailSession && pageAvailability.available ? privy.embedded?.address : undefined}
                      onBrowse={openBoard}
                      aside={vaults.present ? { kind: "vault", usd: vaults.usd } : holdsCash ? { kind: "cash" } : undefined}
                      frame={frame}
                      title={title}
                    />
                  ),
                  firstBuy: (frame, title, note, buy) => (
                    <FirstBuyStep
                      readyUsd={spendable}
                      loading={buy.loading}
                      unfunded={buy.unfunded}
                      onBuy={openBuy}
                      onBrowse={openBoard}
                      onAsk={askAvailable ? openChat : undefined}
                      onReadNews={openNewsOn}
                      frame={frame}
                      title={title}
                      note={note}
                    />
                  ),
                }}
              />
            ),
          }}
          next={
            stage === "empty" ? (
              <AddMoneyStep
                walletAccount={!emailSession}
                onAddMoney={openAddMoney}
                cardAddress={emailSession && pageAvailability.available ? privy.embedded?.address : undefined}
                onBrowse={openBoard}
                aside={vaults.present ? { kind: "vault", usd: vaults.usd } : holdsCash ? { kind: "cash" } : undefined}
              />
            ) : (
              // Only a live "funded" may say the wallet holds money; one from
              // memory holds the line's place until the balances are known.
              <FirstBuyStep
                readyUsd={spendable}
                loading={live.stage !== "funded"}
                onBuy={openBuy}
                onBrowse={openBoard}
                onAsk={askAvailable ? openChat : undefined}
                onReadNews={openNewsOn}
              />
            )
          }
          strips={
            <>
              {firstStock && (
                <FirstStockCard
                  listing={firstStock}
                  inWallet={firstInWallet}
                  onAsk={askAvailable ? openChat : undefined}
                  onReadNews={openNewsOn}
                  onDismiss={() => {
                    rememberFirstStockClosed("1");
                    closeFirstStock.mutate();
                  }}
                />
              )}
              {/* Only while a limit order waits, and only behind its switch. */}
              <WaitingOrders />
              <UnlinkedWalletPrompt hidden={accountOpen} />
              {/* At most one prompt strip at a time: the waiting-orders strip
                  and the unlinked-wallet prompt above both outrank this one
                  (lib/email-nudge). */}
              <EmailNudgeLine
                otherStripShowing={waitingOrdersShowing || unlinkedWalletShowing || pathShown}
                onOpen={openAccountForEmail}
                onShowingChange={setEmailNudgeShowing}
              />
              {/* Once per account (lib/server/notices): the policy's promise to say a change in the app. */}
              <SocialNoticeLine
                hidden={waitingOrdersShowing || unlinkedWalletShowing || pathShown}
                onOpen={openAccountForFriends}
              />
              {/* Once per account, after the social notice: the new terms and privacy policy. */}
              <PolicyNoticeLine hidden={waitingOrdersShowing || unlinkedWalletShowing || pathShown} />
              {/* Any account with no friends (lib/server/social/founder): the founder as a first friend, beside
                  the person's own link. Waits for the notices above and the feedback ask; "Not now" closes it for good. */}
              <FirstFriendLine
                hidden={waitingOrdersShowing || unlinkedWalletShowing || pathShown || emailNudgeShowing}
                onShareLink={openAccountForFriends}
              />
              {/* Once per account, a day after the first completed buy (lib/feedback feedbackPromptDue):
                  last of the one-off strips, and only when none of them, nor the first stock card, is showing. */}
              <FeedbackPromptLine
                hidden={waitingOrdersShowing || unlinkedWalletShowing || pathShown || emailNudgeShowing || firstStock !== null}
              />
              <NudgeLine
                hide={pathShown || pathWaiting ? NUDGES_SAID_BY_PATH : stage ? NUDGES_SAID_BY_STEP[stage] : undefined}
                onAddFunds={openAddMoney}
                onParkCash={() => openBuy(CASH_LISTING)}
                onOpenAccount={() => openAccount()}
              />
              {/* The campaign line, for an account that opened through a campaign's link (lib/campaigns campaignLinePlace).
                  Here once the path is done or skipped: last, and only once the step and the holdings are settled. */}
              {campaignPlace === "strips" && <CampaignLine enabled={hasAccount} onAcceptTerms={() => setCampaignTermsOpen(true)} />}
            </>
          }
          moneyAside={moneyAside}
          money={money}
          ask={
            // On a phone the docked field is the way in.
            askAvailable !== false && (
              <div className="hidden lg:block">
                {askAvailable ? <AskCard onOpen={openChat} /> : <AskCardPlaceholder />}
              </div>
            )
          }
          more={
            <>
              <HomeMore
                onBoard={openBoard}
                onNews={() => setNewsOpen(true)}
                onAi={assistantReachable ? () => setAiOpen(true) : undefined}
              />
              {/* While the path is on screen: the campaign line from the start, quietly, far from the path's Buy. */}
              {campaignPlace === "aside" && <CampaignLine enabled={hasAccount} quiet onAcceptTerms={() => setCampaignTermsOpen(true)} />}
            </>
          }
        />

        <SectionDrawer open={boardOpen} onOpenChange={setBoardOpen} title={copy.boardTitle} description={copy.calmHome.moreBoardSub}>
          <ListingBoard
            expandAll
            onBuy={(listing) => {
              setBoardOpen(false);
              openBuy(listing);
              setBoardReturn(true);
            }}
            onSell={(listing) => {
              setBoardOpen(false);
              openSell(listing);
              setBoardReturn(true);
            }}
            // A row can point the news at itself: the news drawer opens on it.
            onFilterNews={(listing) => {
              setNewsFilter(listing);
              setNewsFocus(null);
              setBoardOpen(false);
              setNewsOpen(true);
            }}
            newsFilterSymbol={newsFilter?.symbol}
          />
        </SectionDrawer>
        <SectionDrawer
          open={newsOpen}
          onOpenChange={(next) => {
            setNewsOpen(next);
            // A filter set from a board row lasts as long as the drawer it opened.
            if (!next) {
              setNewsFilter(null);
              setNewsFocus(null);
            }
          }}
          title={copy.newsTitle}
          description={copy.calmHome.moreNewsSub}
        >
          <NewsFeed
            filter={newsFilter}
            focus={newsFocus}
            onClearFilter={() => {
              setNewsFilter(null);
              setNewsFocus(null);
            }}
            // The sections for what you own; the symbols stay in the browser (app/api/news).
            held={holdings.settled ? stocksHeld.map((holding) => holding.listing.symbol) : undefined}
          />
        </SectionDrawer>
        {assistantReachable && (
          <SectionDrawer open={aiOpen} onOpenChange={setAiOpen} title={copy.assistantTitle} description={copy.calmHome.moreAiSub}>
            <AssistantCard
              onChoose={(assistant) => {
                setAiOpen(false);
                openAccount(assistant);
              }}
            />
          </SectionDrawer>
        )}
        <AddMoneyDrawer
          open={addMoneyOpen}
          onOpenChange={onAddMoneyOpenChange}
          arrival={
            handoff.view
              ? { view: handoff.view, target: handoffTo, listingName: topUpName, onChoose: chooseAfterArrival, onPayAnotherWay: payAnotherWay }
              : null
          }
        />

        <CommandMenu
          open={commandOpen}
          onOpenChange={setCommandOpen}
          onBuy={openBuy}
          onOpenBoard={openBoard}
          onOpenAccount={() => openAccount()}
          onOpenFriends={openAccountForFriends}
          onOpenAsk={askAvailable ? () => openChat() : undefined}
        />
        <DraftLinkOpener onBuy={openDraftBuy} onSell={openDraftSell} />
        <DepositDrawer
          listing={buyListing}
          prefill={buyPrefill}
          preferPay={preferPay}
          open={buyGate === "drawer"}
          confirmTerms={pageAvailability.available ? confirmTerms : undefined}
          onOpenChange={onBuyOpenChange}
          onConnectWallet={openWallet}
          onSignIn={privy.enabled ? privy.login : undefined}
          onTopUp={() => {
            // Leaving for the account drawer is not a return to the chat.
            setChatReturn(false);
            setBuyOpen(false);
            openAddMoney();
            // Money added from here comes back to this order (lib/funding-handoff).
            setTopUpFor(buyListing);
          }}
        />
        <SellHost
          listing={sellListing}
          prefill={sellPrefill}
          open={sellGate === "drawer"}
          onOpenChange={onSellOpenChange}
          onConnectWallet={openWallet}
        />
        <TermsSheet
          open={termsSheetFor !== null || confirmAsk}
          purpose={confirmAsk ? "buy" : (termsSheetFor ?? "buy")}
          pending={!confirmAsk && buyGate === "wait"}
          onAccept={async () => {
            const saved = await terms.accept();
            if (saved && confirmAsk) answerConfirm(true);
            if (saved) {
              setCampaignTermsOpen(false);
              // The campaign line reads the yes afresh: "Accept the terms" goes once it is recorded.
              void queryClient.invalidateQueries({ queryKey: ["campaign"] });
            }
            return saved;
          }}
          onLeave={() => {
            if (confirmAsk) answerConfirm(false);
            else if (termsSheetFor === "sell") setSellSkippedTerms(true);
            else if (termsSheetFor === "campaign") setCampaignTermsOpen(false);
            else onBuyOpenChange(false);
          }}
        />
        <WithdrawHost
          vault={withdrawVault}
          open={withdrawOpen}
          onOpenChange={setWithdrawOpen}
          onConnectWallet={openWallet}
        />
        <WalletDrawer open={walletOpen} onOpenChange={setWalletOpen} />
        {chatLoaded && (
          <ChatHost
            open={chatOpen}
            onOpenChange={(next) => {
              setChatOpen(next);
              // A suggestion not yet sent does not outlive the sheet.
              if (!next) setPendingPrompt(null);
            }}
            onOpenDraft={openChatDraft}
            pending={pendingPrompt}
            onPendingTaken={takePending}
            onBusyChange={setChatBusy}
          />
        )}

        <footer className="mt-9 flex flex-col gap-1 text-center text-xs text-muted-foreground">
          <span className="text-[11px] text-muted-foreground">
            {copy.footerNote}
          </span>
        </footer>
      </div>
      {askAvailable && <AskDock onOpen={() => openChat()} hidden={anyDrawerOpen} busy={chatBusy} />}
      </>
      )}
      </FundingProvider>
    </FirstPathProvider>
  );
}

/**
 * The home's order (2026-10-01, the calm home), shared with the dev gallery
 * so the two cannot drift. One next step per state, and at most one more
 * thing under it before the quieter rows:
 *
 *   empty    the step (add money), any strip, funds and cash if they have
 *            anything to say, an earlier vault position
 *   funded   the step (buy your first stock or fund), any strip, funds and cash
 *   owns     the total, what it owns, Buy, any strip, funds and cash
 *
 * Before a first stock, money set aside (cash, or dollars waiting in a
 * limit order) puts the total above the step. While the stage is unknown
 * the step's place is held and funds and cash still show.
 *
 * The second track (beside on a desktop, after on a phone) is Ask and what
 * sits one tap away: the board, the news, your AI. While the stage is not
 * known and none is remembered, the step's place is held.
 */
export function HomeTracks({
  stage,
  banner,
  total,
  owned,
  buy,
  next,
  strips,
  money,
  moneyAside = false,
  ask,
  more,
  path,
}: {
  /**
   * The guided first path (components/first-path), while it is on screen
   * or still being read: its card takes the next step's place, and once
   * the account owns something it leads the page and Buy goes quiet.
   */
  path?: { shown: boolean; waiting: boolean; card: ReactNode };
  stage: HomeStage | undefined;
  /** Cash parked or money waiting in an order: the total shows before a first stock too. */
  moneyAside?: boolean;
  banner: ReactNode;
  total: ReactNode;
  owned: ReactNode;
  buy: ReactNode;
  next: ReactNode;
  strips: ReactNode;
  money: ReactNode;
  ask: ReactNode;
  more: ReactNode;
}) {
  const place = pathPlace(path);
  return (
    <div className={BOARD_GRID}>
      <div className={BOARD_TRACK}>
        {/* Only where Berth is not available: what still works, quietly. */}
        {banner}
        {stage === "owns" ? (
          <>
            {/* The path's place is held while it is read, so the total never jumps when it lands. */}
            {place === "card" ? path?.card : place === "hold" && <NextStepSkeleton />}
            {total}
            {owned}
            {buy}
          </>
        ) : (
          <>
            {moneyAside && total}
            {stage === undefined || place === "hold" ? <NextStepSkeleton /> : place === "card" ? path?.card : next}
          </>
        )}
        {strips}
        {money}
      </div>
      <div className={BOARD_TRACK}>
        {ask}
        {more}
      </div>
    </div>
  );
}

/**
 * The sticky bar: the brand, the info button and the account pill (passed
 * in, so the dev gallery can shoot the bar without a session). Ask lives in
 * the right column on a desktop and in the dock on a phone, so the bar only
 * carries its button while neither is shown, for an account whose Assistant
 * is still locked: the sheet it opens says what unlocks it.
 */
export function HomeHeader({ onOpenChat, onOpenCommandMenu, children }: { onOpenChat?: () => void; onOpenCommandMenu?: () => void; children: React.ReactNode }) {
  const copy = useCopy();
  return (
    <header className="group/bar sticky top-0 z-10 -mx-4 mb-4 flex h-14 items-center justify-between border-b border-border bg-background px-4 lg:-mx-10 lg:mb-7 lg:h-[60px] lg:px-10">
      {/* Brand never shrinks; the account pill truncates instead. */}
      <div className="flex shrink-0 items-center gap-2">
        <BerthMark className="size-[22px]" />
        <h1 className="font-wordmark text-[19px] leading-none text-foreground">{copy.brand}</h1>
        <BetaPill />
      </div>
      <div className="flex min-w-0 items-center gap-2">
        {onOpenCommandMenu && <CommandHint onOpen={onOpenCommandMenu} />}
        {onOpenChat && <ChatButton onOpen={onOpenChat} />}
        <InfoDrawer />
        {children}
      </div>
    </header>
  );
}

/**
 * The sell drawer for a listing. A sell spends one place: a hub wallet in
 * the Berth account (the home chain signs its message), or, for a stock
 * delivered there, one of the account's own wallets on Robinhood Chain
 * (plan P3a, lib/robinhood-sell: that wallet signs on Robinhood Chain).
 * When more than one place holds it, the drawer lets the person pick,
 * each with its own Max, never the two added into one order.
 * Snapshotted at open: the holdings refetch when the fill lands, and a live
 * zero would unmount the drawer mid-tracking.
 */
function SellHost({
  listing,
  prefill,
  open,
  onOpenChange,
  onConnectWallet,
}: {
  listing: TokenListing | null;
  prefill?: SellPrefill | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnectWallet?: () => void;
}) {
  const account = useHubAccount();
  const holdings = useHubHoldings(account.hubWallets);
  // The sell switch (lib/server/delivery robinhoodSellOn): no wallet on
  // Robinhood Chain is offered as a source unless the route says yes.
  const delivery = useDelivery();
  const sellFromWallet = delivery.robinhoodSell;
  const onRobinhoodChain = useRobinhoodSellBalances(listing, account, open && sellFromWallet);
  // Whether the signer can pay a sell's fee there, for where the sheet opens (rh-ux-sec M2).
  const holdsThere = onRobinhoodChain.held.some((held) => held.balance > 0n);
  const gasThere = useRobinhoodGasReady(account.signerSpoke, open && sellFromWallet && holdsThere);
  const addWallet = useAddConnectedWallet();
  // Snapshotted on open, like the single balance was: balances refetch
  // during the flow, and deriving live would unmount the drawer mid-sell.
  const [snapshot, setSnapshot] = useState<SellSource[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);

  const index = listing ? holdings.holdings.findIndex((holding) => holding.listing.address === listing.address) : -1;
  const sources = (): SellSource[] => [
    ...hubSellSources(
      sellSources(
        account.wallets,
        (hubWallet) =>
          holdings.byWallet.find((wallet) => wallet.hubWallet.toLowerCase() === hubWallet.toLowerCase())?.balances[index] ?? 0n,
        account.signerHubWallet,
      ),
    ),
    ...(sellFromWallet ? robinhoodSellSources(onRobinhoodChain.held, account.signerSpoke) : []),
  ];

  if (!open && snapshot !== null) {
    setSnapshot(null);
    setChosen(null);
  } else if (open && snapshot === null && holdings.settled && delivery.settled && onRobinhoodChain.settled && gasThere.settled && index >= 0) {
    const found = sources();
    setSnapshot(found);
    // One this session can sign for and pay the fee for (the wallet on
    // Robinhood Chain first, and for a drafted quantity the one holding all
    // of it), else the Berth account, else the home, else the first.
    const wanted = prefill?.quantity ? safeUnits(prefill.quantity, listing?.decimals ?? 18) : undefined;
    // A drafted limit opens on the home hub wallet, where a limit can wait (review M2, sell).
    setChosen(
      defaultSellSource(found, wanted, (candidate) => candidate.chain === "hub" || gasThere.ready, { limit: !!prefill?.limit })?.key ??
        null,
    );
  }

  if (!listing || snapshot === null) return null;
  const source = snapshot.find((candidate) => candidate.key === chosen);
  const fromRobinhood = source?.chain === "robinhood" && !!listing.rhAddress;

  return (
    <WithdrawDrawer
      listing={listing}
      open={open}
      onOpenChange={onOpenChange}
      availableShares={source?.balance ?? 0n}
      srcChainKey={fromRobinhood ? ROBINHOOD_CHAIN_KEY : HOME_CHAIN}
      robinhoodSell={fromRobinhood && source ? { rhAddress: listing.rhAddress!, owner: source.spoke } : undefined}
      onConnectWallet={onConnectWallet}
      prefill={prefill}
      sellFrom={
        // One hub wallet, the session's own: the drawer reads as it always
        // did. A wallet on Robinhood Chain is always named, so the person
        // sees where the sell comes from.
        snapshot.length > 1 || snapshot.some((candidate) => candidate.chain === "robinhood") || (source && !source.canSign)
          ? { sources: snapshot, chosen: chosen ?? "", onChoose: setChosen }
          : undefined
      }
      sourceIsHome={!fromRobinhood && source?.isHome !== false}
      // Nothing to sell from but a wallet on Robinhood Chain that may not be offered: said, never a dead Sell.
      robinhoodPaused={robinhoodSellPaused(snapshot, sellFromWallet)}
      signerLinked={account.signerLinked}
      onAddWallet={addWallet.canSign ? () => void addWallet.add() : undefined}
    />
  );
}

/** A drafted quantity in raw units, or undefined when it does not parse. */
function safeUnits(quantity: number, decimals: number): bigint | undefined {
  try {
    return parseUnits(String(quantity), decimals);
  } catch {
    return undefined;
  }
}

/**
 * The withdraw drawer for an earlier vault position. Shares live in a
 * separate derived hub wallet per source chain, so the largest row is
 * picked when the drawer opens and SNAPSHOTTED: balances refetch during the
 * flow (a full withdrawal drains the row to zero), and deriving live would
 * unmount the drawer mid-tracking.
 */
function WithdrawHost({
  vault,
  open,
  onOpenChange,
  onConnectWallet,
}: {
  vault: LeverageYieldVault | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnectWallet?: () => void;
}) {
  const position = useUserVaultPosition(vault?.vault);
  const [snapshot, setSnapshot] = useState<{
    chainKey: (typeof position.sharesByChain)[number]["chainKey"];
    shares: bigint;
    total: bigint;
  } | null>(null);

  const largest = position.sharesByChain.reduce<
    (typeof position.sharesByChain)[number] | null
  >((best, row) => (best === null || row.shares > best.shares ? row : best), null);

  if (!open && snapshot !== null) {
    setSnapshot(null);
  } else if (open && snapshot === null && largest) {
    setSnapshot({
      chainKey: largest.chainKey,
      shares: largest.shares,
      total: position.shares,
    });
  }

  // Opened with nothing withdrawable: close instead of rendering nothing.
  const shouldClose =
    open && snapshot === null && !largest && !position.isLoading;
  useEffect(() => {
    if (shouldClose) onOpenChange(false);
  }, [shouldClose, onOpenChange]);

  if (!vault || !snapshot) return null;

  return (
    <WithdrawDrawer
      listing={vaultListing(vault)}
      open={open}
      onOpenChange={onOpenChange}
      availableShares={snapshot.shares}
      srcChainKey={snapshot.chainKey}
      totalShares={snapshot.total}
      onConnectWallet={onConnectWallet}
    />
  );
}
