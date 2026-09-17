"use client";

import { useEffect, useState } from "react";
import type { LeverageYieldVault } from "@sodax/dapp-kit";
import { WalletDrawer } from "@/components/wallet";
import { AccountButton } from "@/components/account-button";
import { BerthMark } from "@/components/berth-mark";
import { InfoDrawer } from "@/components/info-drawer";
import { useCopy } from "@/components/settings-provider";
import {
  AccountTotal,
  CashShelf,
  HoldingsList,
  ListingBoard,
  NewsFeed,
} from "@/components/board";
import { FundsModule } from "@/components/funds-module";
import { VaultPositions } from "@/components/vaults";
import { DepositDrawer, WithdrawDrawer } from "@/components/flow";
import { useHubAccount } from "@/hooks/use-hub-account";
import { useHubHoldings } from "@/hooks/use-hub-holdings";
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

/**
 * The one screen: what the account is worth, the funds that can pay, what
 * it owns, the cash shelf, the board of stocks and funds, and any earlier
 * vault positions still to be withdrawn. Every order opens a drawer over it.
 */
export function Home() {
  // The buy drawer pours into a listing: a stock or fund from the board, or
  // cash. Vault deposits are no longer offered, so no vault reaches it.
  const [buyListing, setBuyListing] = useState<Listing | null>(null);
  const [buyOpen, setBuyOpen] = useState(false);
  const [sellListing, setSellListing] = useState<TokenListing | null>(null);
  const [sellOpen, setSellOpen] = useState(false);
  const [withdrawVault, setWithdrawVault] =
    useState<LeverageYieldVault | null>(null);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const privy = usePrivyEmbeddedWallet();
  const copy = useCopy();

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
    setBuyListing(listing);
    setBuyOpen(true);
  };
  const openSell = (listing: TokenListing) => {
    setSellListing(listing);
    setSellOpen(true);
  };

  return (
    <AuthGate>
      {/*
        One column on a phone, a composition on a desktop. The account's own
        figure spans the top, then three tracks: what you have on the left,
        what you can buy in the middle, what is being said about it on the
        right. Two tracks from 1024px (the news falls under the board, since
        three columns at that width would squeeze a board row below the space
        its name, line and price need), three from 1280px. Below 1024px
        nothing changes at all: every placement class is breakpoint-prefixed,
        so the phone keeps the single column it was designed as.
      */}
      <div className="mx-auto flex w-full max-w-md flex-col px-4 pb-12 sm:max-w-lg lg:max-w-5xl xl:max-w-7xl">
        <header className="sticky top-0 z-10 -mx-4 mb-5 flex items-center justify-between border-b border-border/60 bg-background/80 px-4 py-3 backdrop-blur">
          {/* Brand never shrinks; the account pill truncates instead. */}
          <div className="flex shrink-0 items-center gap-2">
            <BerthMark className="size-[26px]" />
            <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">
              {copy.brand}
            </h1>
          </div>
          <div className="flex min-w-0 items-center gap-1">
            <InfoDrawer />
            <AccountButton open={accountOpen} onOpenChange={setAccountOpen} />
          </div>
        </header>

        <AccountTotal />

        <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)] lg:items-start lg:gap-5 xl:grid-cols-[minmax(0,20rem)_minmax(0,1fr)_minmax(0,23rem)]">
          {/* What you hold and what can pay for the next order. */}
          <div className="flex flex-col gap-4 lg:col-start-1 lg:row-start-1 lg:row-span-2 xl:row-span-1">
            <FundsModule onTopUp={() => setAccountOpen(true)} />
            <HoldingsList onSell={openSell} />
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
          </div>

          {/* The board keeps the widest track: it is what people come to do. */}
          <div className="lg:col-start-2 lg:row-start-1">
            <ListingBoard onBuy={openBuy} onSell={openSell} />
          </div>

          <div className="lg:col-start-2 lg:row-start-2 xl:col-start-3 xl:row-start-1">
            <NewsFeed />
          </div>
        </div>

        <DepositDrawer
          listing={buyListing}
          open={buyOpen}
          onOpenChange={setBuyOpen}
          onConnectWallet={openWallet}
          onSignIn={privy.enabled ? privy.login : undefined}
          onTopUp={() => {
            setBuyOpen(false);
            setAccountOpen(true);
          }}
        />
        <SellHost
          listing={sellListing}
          open={sellOpen}
          onOpenChange={setSellOpen}
          onConnectWallet={openWallet}
        />
        <WithdrawHost
          vault={withdrawVault}
          open={withdrawOpen}
          onOpenChange={setWithdrawOpen}
          onConnectWallet={openWallet}
        />
        <WalletDrawer open={walletOpen} onOpenChange={setWalletOpen} />

        <footer className="mt-9 flex flex-col gap-1 text-center text-xs text-muted-foreground">
          <span>{copy.poweredBy}</span>
          <span className="text-[11px] text-muted-foreground">
            {copy.footerNote}
          </span>
        </footer>
      </div>
    </AuthGate>
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
  open,
  onOpenChange,
  onConnectWallet,
}: {
  listing: TokenListing | null;
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
