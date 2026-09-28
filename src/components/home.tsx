"use client";

import { useCallback, useEffect, useState } from "react";
import type { LeverageYieldVault } from "@sodax/dapp-kit";
import { WalletDrawer } from "@/components/wallet";
import { AccountButton, useAssistantReachable } from "@/components/account-button";
import { BerthMark } from "@/components/berth-mark";
import { InfoDrawer } from "@/components/info-drawer";
import { useCopy } from "@/components/settings-provider";
import {
  AccountTotal,
  CashShelf,
  HoldingsList,
  ListingBoard,
  NewsFeed,
  NudgeLine,
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
import { draftOpening } from "@/lib/draft-open";

/** The board's frame, shared with the dev gallery (/dev/board?home=…) so the two cannot drift. */
export const BOARD_PAGE = "mx-auto flex w-full max-w-lg flex-col px-4 pb-12 lg:max-w-[75rem] lg:px-8";
export const BOARD_GRID =
  "flex flex-col gap-3.5 lg:grid lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-start lg:gap-6";
export const BOARD_TRACK = "flex min-w-0 flex-col gap-3.5";

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
  const [buyPrefill, setBuyPrefill] = useState<{ usd?: number } | null>(null);
  const [sellPrefill, setSellPrefill] = useState<{ usd?: number; quantity?: number } | null>(null);
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
  const openAccount = (assistant: AssistantId | null = null) => {
    setAccountAssistant(assistant);
    setAccountOpen(true);
  };
  const onAccountOpenChange = (next: boolean) => {
    setAccountOpen(next);
    if (!next) setAccountAssistant(null);
  };
  const [chatReturn, setChatReturn] = useState(false);
  const privy = usePrivyEmbeddedWallet();
  const copy = useCopy();
  // Once the account owns something, what it owns leads the panel, since
  // that is what a returning person comes to see; before the first buy
  // the funds lead, since pouring in is the first thing to do.
  const account = useHubAccount();
  const holdings = useHubHoldings(account.hubWallet);
  // The answer is remembered per account, so a returning holder's panel
  // opens in its settled order instead of reordering when holdings land.
  const [rememberedOwns, rememberOwns] = useStoredChoice(
    account.spokeAddress ? `berth.owns-listings.${account.spokeAddress.toLowerCase()}` : null,
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
  const openDraftBuy = useCallback((listing: TokenListing, prefill: { usd?: number }) => {
    setBuyPrefill(prefill);
    setBuyListing(listing);
    setBuyOpen(true);
  }, []);
  const openDraftSell = useCallback((listing: TokenListing, prefill: { usd?: number; quantity?: number }) => {
    setSellPrefill(prefill);
    setSellListing(listing);
    setSellOpen(true);
  }, []);

  const openChatDraft = (draft: ChatDraft) => {
    const opening = draftOpening(
      { symbol: draft.symbol, side: draft.side, usd: draft.usd, quantity: draft.quantity },
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

  return (
    <AuthGate>
      {/*
        The ledger (2026-09-28): one column on a phone, two from 1024px.
        The left track is the account, top to bottom: its figure beside a
        benchmark, the nudge, what it owns, its money, then the board. The
        right track is what to ask and what is being said. On a phone the
        right track simply follows the left, and Ask docks at the foot.
      */}
      <div className={cn(BOARD_PAGE, askAvailable !== false && DOCK_CLEARANCE)}>
        <HomeHeader onOpenChat={() => openChat()}>
          <AccountButton open={accountOpen} onOpenChange={onAccountOpenChange} assistant={accountAssistant} />
        </HomeHeader>

        <div className={BOARD_GRID}>
          <div className={BOARD_TRACK}>
            <AccountTotal />
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
          />
        )}

        <footer className="mt-9 flex flex-col gap-1 text-center text-xs text-muted-foreground">
          <span className="text-[11px] text-muted-foreground">
            {copy.footerNote}
          </span>
        </footer>
      </div>
      {askAvailable && <AskDock onOpen={() => openChat()} hidden={anyDrawerOpen} />}
    </AuthGate>
  );
}

/**
 * The sticky bar: the brand, Ask, the info button and the account pill
 * (passed in, so the dev gallery can shoot the bar without a session).
 */
export function HomeHeader({ onOpenChat, children }: { onOpenChat: () => void; children: React.ReactNode }) {
  const copy = useCopy();
  return (
    <header
      data-glass="bar"
      className="group/bar sticky top-0 z-10 -mx-4 mb-4 flex items-center justify-between border-b border-border/60 bg-background/80 px-4 py-3 backdrop-blur lg:-mx-8 lg:mb-5 lg:px-8 lg:py-4"
    >
      {/* Brand never shrinks; the account pill truncates instead. */}
      <div className="flex shrink-0 items-center gap-2">
        <BerthMark className="size-[26px]" />
        <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">{copy.brand}</h1>
      </div>
      <div className="flex min-w-0 items-center gap-1">
        <ChatButton onOpen={onOpenChat} />
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
  prefill?: { usd?: number; quantity?: number } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnectWallet?: () => void;
}) {
  const account = useHubAccount();
  const holdings = useHubHoldings(account.hubWallet);
  const [snapshot, setSnapshot] = useState<bigint | null>(null);

  const held = listing
    ? holdings.holdings.find(
        (holding) => holding.listing.address === listing.address,
      )?.balance
    : undefined;

  if (!open && snapshot !== null) {
    setSnapshot(null);
  } else if (open && snapshot === null && holdings.settled && held !== undefined) {
    setSnapshot(held);
  }

  if (!listing || snapshot === null) return null;

  return (
    <WithdrawDrawer
      listing={listing}
      open={open}
      onOpenChange={onOpenChange}
      availableShares={snapshot}
      srcChainKey={HOME_CHAIN}
      onConnectWallet={onConnectWallet}
      prefill={prefill}
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
