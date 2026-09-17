"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { LeverageYieldVault } from "@sodax/dapp-kit";
import { WalletDrawer } from "@/components/wallet";
import { AccountButton } from "@/components/account-button";
import { InfoDrawer } from "@/components/info-drawer";
import { useCopy } from "@/components/settings-provider";
import { VaultList } from "@/components/vaults";
import { CashShelf, ListingBoard } from "@/components/board";
import { DepositDrawer, WithdrawDrawer } from "@/components/flow";
import { useBoardPreview } from "@/hooks/use-board-preview";
import { useHubAccount } from "@/hooks/use-hub-account";
import { useHubHoldings } from "@/hooks/use-hub-holdings";
import { HOME_CHAIN } from "@/lib/account";
import {
  CASH_LISTING,
  vaultListing,
  type Listing,
  type TokenListing,
} from "@/lib/listings";
import { useUserVaultPosition } from "@/hooks/use-user-vault-position";
import { usePrivyEmbeddedWallet } from "@/hooks/use-privy-evm-wallet";
import { TeapotModule } from "@/components/tea/teapot-module";
import { TableTotal } from "@/components/tea/table-total";
import { AuthGate } from "@/components/welcome-screen";

export function Home() {
  // What the deposit drawer pours into: a cup wrapped as a listing, or a
  // stock or cash listing from the board.
  const [depositListing, setDepositListing] = useState<Listing | null>(null);
  const [withdrawVault, setWithdrawVault] =
    useState<LeverageYieldVault | null>(null);
  const [sellListing, setSellListing] = useState<TokenListing | null>(null);
  const [sellOpen, setSellOpen] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  // One-shot post-pour celebration: the poured cup's steam blooms iridescent.
  const [bloomVault, setBloomVault] = useState<string | null>(null);
  const privy = usePrivyEmbeddedWallet();
  const copy = useCopy();
  const boardPreview = useBoardPreview();

  // Email login is the primary path; the external wallet drawer is the
  // fallback for signed-in users reaching for a non-EVM source chain.
  const openWallet = () => {
    if (privy.enabled && !privy.authenticated) {
      privy.login();
      return;
    }
    setWalletOpen(true);
  };

  return (
    <AuthGate>
    <div className="mx-auto flex w-full max-w-md flex-col px-4 pb-12 sm:max-w-lg">
      <header className="sticky top-0 z-10 -mx-4 mb-4 flex items-center justify-between border-b border-border/60 bg-background/80 px-4 py-3 backdrop-blur">
        {/* Brand never shrinks; the account pill truncates instead. Without
            min-w-0 on the right group, the icon button is the only flexible
            item and collapses under its icon, which then overlaps the h1. */}
        <div className="flex shrink-0 items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- tiny inline brand mark */}
          <img src="/lsteatime-mark.svg" alt="" aria-hidden width={30} height={30} />
          <h1 className="font-display text-xl text-foreground">LSTeaTime</h1>
        </div>
        <div className="flex min-w-0 items-center gap-1">
          <InfoDrawer />
          <AccountButton open={accountOpen} onOpenChange={setAccountOpen} />
        </div>
      </header>

      <TableTotal />
      <TeapotModule onTopUp={() => setAccountOpen(true)} />

      <div className="mt-4">
        <VaultList
          bloomVault={bloomVault}
          onDeposit={(vault) => {
            setDepositListing(vaultListing(vault));
            setDepositOpen(true);
          }}
          onWithdraw={(vault) => {
            setWithdrawVault(vault);
            setWithdrawOpen(true);
          }}
        />
      </div>

      {boardPreview && (
        <div className="mt-4 flex flex-col gap-4">
          <CashShelf
            onPark={() => {
              setDepositListing(CASH_LISTING);
              setDepositOpen(true);
            }}
            onTakeOut={() => {
              setSellListing(CASH_LISTING);
              setSellOpen(true);
            }}
          />
          <ListingBoard
            onBuy={(listing) => {
              setDepositListing(listing);
              setDepositOpen(true);
            }}
            onSell={(listing) => {
              setSellListing(listing);
              setSellOpen(true);
            }}
          />
        </div>
      )}

      <DepositDrawer
        listing={depositListing}
        open={depositOpen}
        onOpenChange={setDepositOpen}
        onConnectWallet={openWallet}
        onSignIn={privy.enabled ? privy.login : undefined}
        onTopUp={() => {
          setDepositOpen(false);
          setAccountOpen(true);
        }}
        onPoured={() => {
          const poured = depositListing?.address ?? null;
          setBloomVault(poured);
          // The bloom is a 900ms one-shot; clear so the next pour replays it.
          setTimeout(() => {
            setBloomVault((current) => (current === poured ? null : current));
          }, 2500);
        }}
      />
      <WithdrawHost
        vault={withdrawVault}
        open={withdrawOpen}
        onOpenChange={setWithdrawOpen}
        onConnectWallet={openWallet}
      />
      <SellHost
        listing={sellListing}
        open={sellOpen}
        onOpenChange={setSellOpen}
        onConnectWallet={openWallet}
      />
      <WalletDrawer open={walletOpen} onOpenChange={setWalletOpen} />

      <footer className="mt-9 text-center text-xs text-muted-foreground">
        {copy.mottoLead}{" "}
        <span className="font-display text-foreground/70">
          {copy.mottoDisplay}
        </span>
        <Link
          href="/lore"
          className="mt-1.5 block text-[11px] underline decoration-border underline-offset-2 transition-colors hover:text-foreground"
        >
          {copy.loreLink}
        </Link>
        <span className="mt-1 block text-[10.5px] text-muted-foreground/70">
          {copy.poweredBy}
        </span>
      </footer>
    </div>
    </AuthGate>
  );
}

/**
 * WithdrawDrawer needs the (chainKey, shares) row the withdrawal spends from
 * — shares live in a separate derived hub wallet per source chain. We pick
 * the largest holding when the drawer opens and SNAPSHOT it: balances
 * refetch during the flow (a full withdrawal drains the row to zero), and
 * deriving live would unmount the drawer mid-tracking.
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

  // Render-time state adjustment (not an effect): snapshot the row when the
  // drawer opens, drop it when it closes.
  if (!open && snapshot !== null) {
    setSnapshot(null);
  } else if (open && snapshot === null && largest) {
    setSnapshot({
      chainKey: largest.chainKey,
      shares: largest.shares,
      total: position.shares,
    });
  }

  // Opened with nothing withdrawable — close instead of rendering nothing.
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

/**
 * The sell twin of WithdrawHost for a listing: everything on the shelf lives
 * in THE account, so the row is always (home chain, what the hub wallet
 * holds). Snapshotted at open for the same reason: the holdings refetch when
 * the fill lands, and a live zero would unmount the drawer mid-tracking.
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
