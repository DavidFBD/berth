"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useFundWallet } from "@privy-io/react-auth";
import {
  Copy,
  Envelope,
  Plugs,
  PlusCircle,
  SignOut,
  Wallet,
} from "@phosphor-icons/react";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ConnectButton, WalletDrawer } from "@/components/wallet";
import { PRIVY_ENABLED } from "@/components/privy-provider";
import { usePrivyEmbeddedWallet } from "@/hooks/use-privy-evm-wallet";
import { shortenAddress } from "@/lib/format";

/**
 * Header account entry point. Email login (Privy) is the default; the
 * traditional wallet-connect button is demoted to desktop-only, per the
 * product stance that mobile users live entirely in the email flow.
 * Falls back to the plain ConnectButton when Privy isn't configured.
 */
export function AccountButton() {
  const privy = usePrivyEmbeddedWallet();
  const [accountOpen, setAccountOpen] = useState(false);
  const [walletsOpen, setWalletsOpen] = useState(false);

  if (!PRIVY_ENABLED) return <ConnectButton />;

  if (!privy.ready) return <Skeleton className="h-8 w-24" />;

  if (!privy.authenticated) {
    return (
      <div className="flex items-center gap-2">
        {/* External wallets: desktop-only affordance */}
        <div className="hidden lg:block">
          <ConnectButton />
        </div>
        <Button size="sm" onClick={privy.login}>
          <Envelope className="size-4" />
          Sign in
        </Button>
      </div>
    );
  }

  const email = privy.user?.email?.address;
  const address = privy.embedded?.address;

  return (
    <>
      <button
        type="button"
        onClick={() => setAccountOpen(true)}
        className="flex h-8 items-center gap-2 rounded-full border border-border bg-card px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted"
      >
        <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
        {email ?? (address ? shortenAddress(address) : "Account")}
      </button>

      <Drawer open={accountOpen} onOpenChange={setAccountOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Your account</DrawerTitle>
            <DrawerDescription>
              {email ? `Signed in as ${email}` : "Signed in via email"}
            </DrawerDescription>
          </DrawerHeader>

          <div className="flex flex-col gap-2 p-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
            {address ? (
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(address);
                  toast.success("Address copied", {
                    description:
                      "Works on every EVM network SODAX supports — send funds here to top up.",
                  });
                }}
                className="flex min-h-14 items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted"
              >
                <Wallet className="size-5 text-primary" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm font-medium text-foreground">
                    {shortenAddress(address, 6)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Your deposit address — one address, all EVM networks
                  </span>
                </div>
                <Copy className="size-4 text-muted-foreground" />
              </button>
            ) : (
              <p className="rounded-xl bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground">
                Creating your wallet…
              </p>
            )}

            {address && <FundButton address={address} />}

            {/* External wallets stay a desktop affordance */}
            <button
              type="button"
              onClick={() => {
                setAccountOpen(false);
                setWalletsOpen(true);
              }}
              className="hidden min-h-14 items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted lg:flex"
            >
              <Plugs className="size-5 text-muted-foreground" />
              <span className="flex-1 text-sm font-medium text-foreground">
                Connect an external wallet
              </span>
            </button>

            <Button
              variant="ghost"
              className="justify-start gap-3 px-3 text-muted-foreground"
              onClick={() => {
                setAccountOpen(false);
                void privy.logout();
              }}
            >
              <SignOut className="size-5" />
              Sign out
            </Button>
          </div>
        </DrawerContent>
      </Drawer>

      <WalletDrawer open={walletsOpen} onOpenChange={setWalletsOpen} />
    </>
  );
}

/** Privy's hosted funding modal (card / bank / cross-chain deposit). */
function FundButton({ address }: { address: string }) {
  const { fundWallet } = useFundWallet();

  return (
    <button
      type="button"
      onClick={() => {
        void fundWallet({ address }).catch(() => {
          toast.error("Funding isn't configured yet", {
            description:
              "Enable funding methods in the Privy dashboard, or send crypto to your deposit address above.",
          });
        });
      }}
      className="flex min-h-14 items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted"
    >
      <PlusCircle className="size-5 text-primary" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium text-foreground">Add funds</span>
        <span className="text-xs text-muted-foreground">
          Card, bank, or crypto from any chain
        </span>
      </div>
    </button>
  );
}
