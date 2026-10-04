"use client";

import { useState } from "react";
import { useConnectedChains } from "@sodax/wallet-sdk-react";
import { Wallet } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { shortenAddress } from "@/lib/format";
import { cn } from "@/lib/utils";
import { WalletDrawer } from "./wallet-drawer";
import { useWalletRestore } from "@/hooks/use-wallet-restore";

/**
 * Header wallet button. Disconnected: "Connect" CTA that opens the wallet
 * drawer. Connected: compact pill (single shortened address, or a dot +
 * "N wallets") that opens the same drawer in manage mode. Rendering is
 * gated on `useConnectedChains().status === 'ready'` so the pill doesn't
 * flash "Connect" while the store rehydrates from localStorage.
 */
export function ConnectButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const { chains, total, status } = useConnectedChains();

  // Signed in on a pocketed session while the extension is away
  // (lib/wallet-restore): the pill still names the account, its dot muted.
  const restore = useWalletRestore();
  const asleep = total === 0 && restore.phase === "session" ? restore.address : undefined;
  const singleAddress = total === 1 ? chains[0]?.account.address : asleep;

  return (
    <>
      {status === "loading" ? (
        <Skeleton className={cn("h-8 w-24 rounded-lg", className)} />
      ) : total === 0 && !asleep ? (
        <Button className={className} onClick={() => setOpen(true)}>
          <Wallet />
          Connect
        </Button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={asleep ? "Manage wallets" : `Manage wallets (${total} connected)`}
          className={cn(
            "inline-flex h-8 shrink-0 items-center gap-2 rounded-full border border-border bg-card px-3 text-xs font-medium text-foreground transition-[transform,background-color] duration-150 ease-lift active:scale-[0.96] outline-none select-none",
            "hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
            className,
          )}
        >
          <span aria-hidden className={cn("size-1.5 rounded-full", asleep ? "bg-muted-foreground" : "bg-good")} />
          <span data-ph-mask className="font-mono tabular-nums">
            {singleAddress
              ? shortenAddress(singleAddress)
              : `${total} wallet${total === 1 ? "" : "s"}`}
          </span>
        </button>
      )}
      <WalletDrawer open={open} onOpenChange={setOpen} />
    </>
  );
}
