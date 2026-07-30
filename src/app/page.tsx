"use client";

import { useEffect, useState } from "react";
import type { LeverageYieldVault } from "@sodax/dapp-kit";
import { ConnectButton, WalletDrawer } from "@/components/wallet";
import { VaultList } from "@/components/vaults";
import { DepositDrawer, WithdrawDrawer } from "@/components/flow";
import { useUserVaultPosition } from "@/hooks/use-user-vault-position";

export default function Home() {
  const [depositVault, setDepositVault] = useState<LeverageYieldVault | null>(
    null,
  );
  const [withdrawVault, setWithdrawVault] =
    useState<LeverageYieldVault | null>(null);
  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);

  const openWallet = () => setWalletOpen(true);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col px-4 pb-12 sm:max-w-lg">
      <header className="sticky top-0 z-10 -mx-4 mb-4 flex items-center justify-between border-b border-border/60 bg-background/80 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-2">
          <span className="text-lg" aria-hidden>
            ⚡
          </span>
          <h1 className="text-base font-semibold tracking-tight">
            Leveraged Staked Yield
          </h1>
        </div>
        <ConnectButton />
      </header>

      <p className="mb-6 text-sm text-muted-foreground">
        Deposit any SODAX-supported asset from any network into leveraged
        staked-yield vaults on Sonic.
      </p>

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

      <footer className="mt-10 text-center text-xs text-muted-foreground">
        Powered by SODAX · vaults live on the Sonic hub · no testnet, real
        funds
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
