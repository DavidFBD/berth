"use client";

import { useEffect, useState } from "react";
import type { LeverageYieldVault } from "@sodax/dapp-kit";
import { WalletDrawer } from "@/components/wallet";
import { AccountButton } from "@/components/account-button";
import { InfoDrawer } from "@/components/info-drawer";
import { VaultList } from "@/components/vaults";
import { DepositDrawer, WithdrawDrawer } from "@/components/flow";
import { useUserVaultPosition } from "@/hooks/use-user-vault-position";
import { usePrivyEmbeddedWallet } from "@/hooks/use-privy-evm-wallet";
import { TeapotModule } from "@/components/tea/teapot-module";

export default function Home() {
  const [depositVault, setDepositVault] = useState<LeverageYieldVault | null>(
    null,
  );
  const [withdrawVault, setWithdrawVault] =
    useState<LeverageYieldVault | null>(null);
  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const privy = usePrivyEmbeddedWallet();

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
    <div className="mx-auto flex w-full max-w-md flex-col px-4 pb-12 sm:max-w-lg">
      <header className="sticky top-0 z-10 -mx-4 mb-4 flex items-center justify-between border-b border-border/60 bg-background/80 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- tiny inline brand mark */}
          <img src="/lsteatime-mark.svg" alt="" aria-hidden width={30} height={30} />
          <h1 className="font-display text-xl text-foreground">LSTeaTime</h1>
        </div>
        <div className="flex items-center gap-1">
          <InfoDrawer />
          <AccountButton open={accountOpen} onOpenChange={setAccountOpen} />
        </div>
      </header>

      <TeapotModule onTopUp={() => setAccountOpen(true)} />

      <div className="mt-4">
        <VaultList
          onDeposit={(vault) => {
            setDepositVault(vault);
            setDepositOpen(true);
          }}
          onWithdraw={(vault) => {
            setWithdrawVault(vault);
            setWithdrawOpen(true);
          }}
        />
      </div>

      <DepositDrawer
        vault={depositVault}
        open={depositOpen}
        onOpenChange={setDepositOpen}
        onConnectWallet={openWallet}
      />
      <WithdrawHost
        vault={withdrawVault}
        open={withdrawOpen}
        onOpenChange={setWithdrawOpen}
        onConnectWallet={openWallet}
      />
      <WalletDrawer open={walletOpen} onOpenChange={setWalletOpen} />

      <footer className="mt-9 text-center text-xs text-muted-foreground">
        Tea is the way.{" "}
        <span className="font-display text-foreground/70">
          LSTeaTime is the best time.
        </span>
        <span className="mt-1 block text-[10.5px] text-muted-foreground/70">
          Powered by SODAX · real funds, real tea — no testnet
        </span>
      </footer>
    </div>
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
      vault={vault}
      open={open}
      onOpenChange={onOpenChange}
      availableShares={snapshot.shares}
      srcChainKey={snapshot.chainKey}
      totalShares={snapshot.total}
      onConnectWallet={onConnectWallet}
    />
  );
}
