"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useAddFunds } from "@privy-io/react-auth";
import { useWallets as useSolanaWallets } from "@privy-io/react-auth/solana";
import { QRCodeSVG } from "qrcode.react";
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
import { useMounted } from "@/hooks/use-mounted";
import { PRIVY_ENABLED } from "@/components/privy-provider";
import { usePrivyEmbeddedWallet } from "@/hooks/use-privy-evm-wallet";
import { shortenAddress } from "@/lib/format";

/**
 * Header account entry point. Email login (Privy) is the default; the
 * traditional wallet-connect button is demoted to desktop-only, per the
 * product stance that mobile users live entirely in the email flow.
 * Falls back to the plain ConnectButton when Privy isn't configured.
 */
export function AccountButton({
  open: openProp,
  onOpenChange,
}: {
  /** Optional controlled open state so the page (teapot Top up) can open the pantry. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
} = {}) {
  const privy = usePrivyEmbeddedWallet();
  const mounted = useMounted();
  const [accountOpenState, setAccountOpenState] = useState(false);
  const accountOpen = openProp ?? accountOpenState;
  const setAccountOpen = onOpenChange ?? setAccountOpenState;
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
            <DrawerTitle>Your pantry</DrawerTitle>
            <DrawerDescription>
              {email ? `Signed in as ${email}` : "Signed in via email"}
            </DrawerDescription>
          </DrawerHeader>

          <div className="flex flex-col gap-2 p-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
            {address ? (
              <>
                <div className="flex items-center justify-center rounded-xl border border-border bg-white p-3 dark:bg-neutral-100">
                  <QRCodeSVG value={address} size={144} marginSize={1} />
                </div>
                <ReceiveRow
                  label="Fill your teapot — one address, every EVM network"
                  address={address}
                  copyToast="Works on every EVM network SODAX supports — send funds here to top up."
                />
                {/* Privy's /solana hooks are not SSR-safe — client-only. */}
                {mounted && <SolanaReceive />}
              </>
            ) : (
              <p className="rounded-xl bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground">
                Warming the pot…
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

/** Embedded Solana address row — isolated because the hook is client-only. */
function SolanaReceive() {
  const { wallets: solanaWallets } = useSolanaWallets();
  // Duck-typed: the d.ts exports PrivyStandardWallet but the runtime module
  // doesn't (Privy build mismatch), so check the class's getter directly.
  const solanaAddress = solanaWallets.find(
    (wallet) =>
      (wallet.standardWallet as { isPrivyWallet?: boolean }).isPrivyWallet ===
      true,
  )?.address;

  if (!solanaAddress) return null;
  return (
    <ReceiveRow
      label="Fill your teapot — Solana"
      address={solanaAddress}
      copyToast="Only send Solana assets (SOL, JitoSOL, USDC…) to this one."
    />
  );
}

function ReceiveRow({
  label,
  address,
  copyToast,
}: {
  label: string;
  address: string;
  copyToast: string;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(address);
        toast.success("Address copied", { description: copyToast });
      }}
      className="flex min-h-14 items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted"
    >
      <Wallet className="size-5 text-primary" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium text-foreground">
          {shortenAddress(address, 6)}
        </span>
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <Copy className="size-4 text-muted-foreground" />
    </button>
  );
}

/** USDC on Base — cheap, every onramp speaks it; the default landing asset. */
const FUND_DESTINATION_CHAIN = "eip155:8453" as const;
const FUND_DESTINATION_ASSET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

/**
 * Privy's unified funding modal (useAddFunds): surfaces every method enabled
 * in the dashboard — card/Apple/Google Pay onramps (incl. Stripe), external
 * wallet transfer, cross-chain deposit — no code changes when toggles flip.
 */
function FundButton({ address }: { address: string }) {
  const { addFunds } = useAddFunds();

  return (
    <button
      type="button"
      onClick={() => {
        addFunds({
          destination: {
            address,
            chain: FUND_DESTINATION_CHAIN,
            asset: FUND_DESTINATION_ASSET,
          },
          fiat: {},
          crypto: {},
        })
          .then(() => {
            toast.success("Teapot topped up", {
              description: "USDC is on its way to your pantry.",
            });
          })
          .catch(() => {
            // Rejection includes plain user exit — stay quiet unless nothing
            // is configured, which Privy surfaces inside its own modal.
          });
      }}
      className="flex min-h-14 items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted"
    >
      <PlusCircle className="size-5 text-primary" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium text-foreground">Fill the teapot</span>
        <span className="text-xs text-muted-foreground">
          Card, bank, or crypto from any chain
        </span>
      </div>
    </button>
  );
}
