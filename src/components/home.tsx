"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LeverageYieldVault } from "@sodax/dapp-kit";
import { WalletDrawer } from "@/components/wallet";
import { AccountButton, useAssistantReachable } from "@/components/account-button";
import { BerthMark } from "@/components/berth-mark";
import { InfoDrawer } from "@/components/info-drawer";
import { useCopy } from "@/components/settings-provider";
import {
  AccountTotal,
  CashShelf,
  EmailNudgeLine,
  HoldingsList,
  ListingBoard,
  NewsFeed,
  NudgeLine,
  WaitingOrders,
  useWaitingOrdersShowing,
} from "@/components/board";
import { AskCard, AskCardPlaceholder, AskDock, DOCK_CLEARANCE } from "@/components/chat/ask-surfaces";
import { useAskAvailable } from "@/components/chat/chat-status";
import { AssistantCard } from "@/components/assistant/assistant-card";
import type { AssistantId } from "@/lib/assistant-party";
import { cn } from "@/lib/utils";
import { FundsModule } from "@/components/funds-module";
import { Panel } from "@/components/ui/panel";
import { VaultPositions } from "@/components/vaults";
import { DepositDrawer, WithdrawDrawer } from "@/components/flow";
import { useHubAccount } from "@/hooks/use-hub-account";
import { useHubHoldings } from "@/hooks/use-hub-holdings";
import { useAddConnectedWallet, useUnlinkedWalletShowing } from "@/hooks/use-account-wallets";
import { UnlinkedWalletPrompt } from "@/components/account-wallets";
import { sellSources } from "@/lib/account-wallets";
import { useStoredChoice } from "@/hooks/use-stored-choice";
import { useUserVaultPosition } from "@/hooks/use-user-vault-position";
import { usePrivyEmbeddedWallet } from "@/hooks/use-privy-evm-wallet";
import { HOME_CHAIN } from "@/lib/account";
import {
  CASH_LISTING,
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
import { RecurringStrip, useRecurringStripShowing } from "@/components/recurring/recurring-strip";
import { PlanSheetHost } from "@/components/recurring/plan-sheet";
import { useAccountHeaders } from "@/hooks/use-profile";
import { onPlanSheet, openPlanSheet } from "@/components/recurring/plan-sheet-events";
import { NoAccountHere, NotHereBanner, useAvailability } from "@/components/availability/availability";
import { useUnavailableRefused } from "@/lib/unavailable-refusal";

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
  const openAccount = (assistant: AssistantId | null = null) => {
    setAccountAssistant(assistant);
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
    }
  };
  // Whether a higher-priority strip already holds the email nudge's slot.
  const waitingOrdersShowing = useWaitingOrdersShowing();
  const unlinkedWalletShowing = useUnlinkedWalletShowing(accountOpen);
  const recurringShowing = useRecurringStripShowing();
  // A plan needs an account to belong to: signed out, the buy drawer does not offer one.
  const hasAccount = useAccountHeaders({ prompt: false }).key !== null;
  const [chatReturn, setChatReturn] = useState(false);
  // The plan sheet takes the screen: whichever drawer asked for it has closed, and the chat does too.
  // Asked for from the chat (the Assistant's plan card), closing the sheet brings the chat back.
  const chatOpenNow = useRef(false);
  useEffect(() => {
    chatOpenNow.current = chatOpen;
  }, [chatOpen]);
  useEffect(
    () =>
      onPlanSheet(() => {
        if (chatOpenNow.current) setChatReturn(true);
        setChatOpen(false);
      }),
    [],
  );
  const privy = usePrivyEmbeddedWallet();
  const copy = useCopy();
  // Once the account owns something, what it owns leads the panel, since
  // that is what a returning person comes to see; before the first buy
  // the funds lead, since pouring in is the first thing to do.
  const account = useHubAccount();
  const holdings = useHubHoldings(account.hubWallets);
  // The answer is remembered per account, so a returning holder's panel
  // opens in its settled order instead of reordering when holdings land.
  // Keyed by the account's home, not by where this session's buys land
  // (the signer's own wallet), so every wallet of one account shares it.
  const accountKey = account.wallets.find((wallet) => wallet.isHome)?.spoke ?? account.spokeAddress;
  const [rememberedOwns, rememberOwns] = useStoredChoice(
    accountKey ? `berth.owns-listings.${accountKey.toLowerCase()}` : null,
  );
  const liveOwns = holdings.settled
    ? holdings.held.some((holding) => holding.listing.kind === "stock")
    : undefined;
  const ownsListings = liveOwns ?? rememberedOwns === "1";
  useEffect(() => {
    if (liveOwns === undefined) return;
    const next = liveOwns ? "1" : "0";
    if (rememberedOwns !== next) rememberOwns(next);
  }, [liveOwns, rememberedOwns, rememberOwns]);

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
    setBuyPrefill(null);
    setBuyListing(listing);
    setBuyOpen(true);
  };
  const openSell = (listing: TokenListing) => {
    setChatReturn(false);
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
      { settled: holdings.settled, heldAddresses: holdings.held.map((holding) => holding.listing.address) },
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
  const onBuyOpenChange = (next: boolean) => {
    setBuyOpen(next);
    if (!next) returnToChat();
  };
  const onSellOpenChange = (next: boolean) => {
    setSellOpen(next);
    if (!next) returnToChat();
  };

  const anyDrawerOpen = chatOpen || buyOpen || sellOpen || withdrawOpen || walletOpen || accountOpen;

  const moneyRows = (
    <Panel key="money" className="divide-y divide-border">
      <FundsModule onTopUp={() => openAccount()} />
      <CashShelf
        onPark={() => openBuy(CASH_LISTING)}
        onTakeOut={() => openSell(CASH_LISTING)}
      />
      <VaultPositions
        onWithdraw={(vault) => {
          setWithdrawVault(vault);
          setWithdrawOpen(true);
        }}
      />
    </Panel>
  );
  const owned = (
    <Panel key="owned">
      <HoldingsList onSell={openSell} />
    </Panel>
  );

  // Where Berth is not available, a sign in the server made no account
  // for (lib/server/availability) says so instead of an empty board.
  const availability = useAvailability();
  const noAccountHere = useUnavailableRefused("/api/profile");

  return (
    <AuthGate>
      {noAccountHere ? (
        <NoAccountHere availability={availability} />
      ) : (
      <>
      {/*
        The ledger (2026-09-28): one column on a phone, two from 1024px.
        The left track is the account, top to bottom: its figure beside a
        benchmark, the nudge, what it owns, its money, then the board. The
        right track is what to ask and what is being said. On a phone the
        right track simply follows the left, and Ask docks at the foot.
      */}
      <div className={cn(BOARD_PAGE, askAvailable !== false && DOCK_CLEARANCE)}>
        <HomeHeader onOpenChat={askAvailable === false ? () => openChat() : undefined}>
          <AccountButton
            open={accountOpen}
            onOpenChange={onAccountOpenChange}
            assistant={accountAssistant}
            focusEmail={focusEmail}
          />
        </HomeHeader>

        <div className={BOARD_GRID}>
          <div className={BOARD_TRACK}>
            {/* Only where Berth is not available: what still works, quietly. */}
            <NotHereBanner />
            <AccountTotal />
            {/* Only on a recurring plan's day (lib/recurring): Berth reminds, the person signs. */}
            <RecurringStrip onOpen={openDraftBuy} />
            {/* Only while a limit order waits, and only behind its switch. */}
            <WaitingOrders />
            <UnlinkedWalletPrompt hidden={accountOpen} />
            {/* At most one prompt strip at a time: the waiting-orders strip
                and the unlinked-wallet prompt above both outrank this one
                (lib/email-nudge). */}
            <EmailNudgeLine
              otherStripShowing={waitingOrdersShowing || unlinkedWalletShowing || recurringShowing}
              onOpen={openAccountForEmail}
            />
            <NudgeLine
              onAddFunds={() => openAccount()}
              onParkCash={() => openBuy(CASH_LISTING)}
              onOpenAccount={() => openAccount()}
            />
            {/* Once the account owns something, what it owns leads, since
                that is what a returning person comes to see; before the
                first buy the money leads, since adding funds comes first. */}
            {ownsListings ? [owned, moneyRows] : [moneyRows, owned]}
            <ListingBoard
              onBuy={openBuy}
              onSell={openSell}
              onFilterNews={(listing) =>
                setNewsFilter((current) =>
                  current?.symbol === listing.symbol ? null : listing,
                )
              }
              newsFilterSymbol={newsFilter?.symbol}
            />
          </div>

          <div className={BOARD_TRACK}>
            {/* On a phone the docked field is the way in. */}
            {askAvailable !== false && (
              <div className="hidden lg:block">
                {askAvailable ? <AskCard onOpen={openChat} /> : <AskCardPlaceholder />}
              </div>
            )}
            <NewsFeed
              filter={newsFilter}
              onClearFilter={() => setNewsFilter(null)}
              collapsible
            />
            {assistantReachable && <AssistantCard onChoose={(assistant) => openAccount(assistant)} />}
          </div>
        </div>

        <DraftLinkOpener onBuy={openDraftBuy} onSell={openDraftSell} />
        <PlanSheetHost onSignIn={openWallet} onClosed={returnToChat} />
        <DepositDrawer
          listing={buyListing}
          prefill={buyPrefill}
          open={buyOpen}
          onOpenChange={onBuyOpenChange}
          onConnectWallet={openWallet}
          onSignIn={privy.enabled ? privy.login : undefined}
          onTopUp={() => {
            // Leaving for the account drawer is not a return to the chat.
            setChatReturn(false);
            setBuyOpen(false);
            openAccount();
          }}
          onMakeRecurring={
            hasAccount
              ? (listing, usd) => {
                  setChatReturn(false);
                  setBuyOpen(false);
                  openPlanSheet({ symbol: listing.symbol, usd });
                }
              : undefined
          }
        />
        <SellHost
          listing={sellListing}
          prefill={sellPrefill}
          open={sellOpen}
          onOpenChange={onSellOpenChange}
          onConnectWallet={openWallet}
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
    </AuthGate>
  );
}

/**
 * The sticky bar: the brand, the info button and the account pill (passed
 * in, so the dev gallery can shoot the bar without a session). Ask lives in
 * the right column on a desktop and in the dock on a phone, so the bar only
 * carries its button while neither is shown, for an account whose Assistant
 * is still locked: the sheet it opens says what unlocks it.
 */
export function HomeHeader({ onOpenChat, children }: { onOpenChat?: () => void; children: React.ReactNode }) {
  const copy = useCopy();
  return (
    <header className="group/bar sticky top-0 z-10 -mx-4 mb-4 flex h-14 items-center justify-between border-b border-border bg-background px-4 lg:-mx-10 lg:mb-7 lg:h-[60px] lg:px-10">
      {/* Brand never shrinks; the account pill truncates instead. */}
      <div className="flex shrink-0 items-center gap-2">
        <BerthMark className="size-[22px]" />
        <h1 className="font-wordmark text-[19px] leading-none text-foreground">{copy.brand}</h1>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        {onOpenChat && <ChatButton onOpen={onOpenChat} />}
        <InfoDrawer />
        {children}
      </div>
    </header>
  );
}

/**
 * The sell drawer for a listing: everything the account owns lives in one
 * hub wallet, so the row is always (home chain, what the hub wallet holds).
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
  const addWallet = useAddConnectedWallet();
  // Snapshotted on open, like the single balance was: balances refetch
  // during the flow, and deriving live would unmount the drawer mid-sell.
  const [snapshot, setSnapshot] = useState<ReturnType<typeof sellSources> | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);

  const index = listing ? holdings.holdings.findIndex((holding) => holding.listing.address === listing.address) : -1;
  const sources = () =>
    sellSources(
      account.wallets,
      (hubWallet) =>
        holdings.byWallet.find((wallet) => wallet.hubWallet.toLowerCase() === hubWallet.toLowerCase())?.balances[index] ?? 0n,
      account.signerHubWallet,
    );

  if (!open && snapshot !== null) {
    setSnapshot(null);
    setChosen(null);
  } else if (open && snapshot === null && holdings.settled && index >= 0) {
    const found = sources();
    setSnapshot(found);
    // The one this session can sign for, else the home, else the first.
    setChosen((found.find((source) => source.canSign) ?? found.find((source) => source.isHome) ?? found[0])?.spoke ?? null);
  }

  if (!listing || snapshot === null) return null;
  const source = snapshot.find((candidate) => candidate.spoke === chosen);

  return (
    <WithdrawDrawer
      listing={listing}
      open={open}
      onOpenChange={onOpenChange}
      availableShares={source?.balance ?? 0n}
      srcChainKey={HOME_CHAIN}
      onConnectWallet={onConnectWallet}
      prefill={prefill}
      sellFrom={
        // One hub wallet, the session's own: the drawer reads as it always did.
        snapshot.length > 1 || (source && !source.canSign)
          ? { sources: snapshot, chosen: chosen ?? "", onChoose: setChosen }
          : undefined
      }
      sourceIsHome={source?.isHome !== false}
      signerLinked={account.signerLinked}
      onAddWallet={addWallet.canSign ? () => void addWallet.add() : undefined}
    />
  );
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
