"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AnimatePresence, motion } from "motion/react";
import { useAddFunds } from "@privy-io/react-auth";
import { useWallets as useSolanaWallets } from "@privy-io/react-auth/solana";
import { QRCodeSVG } from "qrcode.react";
import {
  Copy,
  GearSix,
  PlusCircle,
  QrCode,
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
import { ConnectButton } from "@/components/wallet";
import { SettingsDrawer } from "@/components/settings-drawer";
import { RankChip, TeaService } from "@/components/tea-service";
import { useCopy } from "@/components/settings-provider";
import { useMounted } from "@/hooks/use-mounted";
import { PRIVY_ENABLED } from "@/components/privy-provider";
import { usePrivyEmbeddedWallet } from "@/hooks/use-privy-evm-wallet";
import { shortenAddress } from "@/lib/format";
import { SPRING_SHELF } from "@/lib/motion";

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
  const copy = useCopy();
  const [accountOpenState, setAccountOpenState] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const accountOpen = openProp ?? accountOpenState;
  const setAccountOpen = onOpenChange ?? setAccountOpenState;

  if (!PRIVY_ENABLED) return <ConnectButton />;

  if (!privy.ready) return <Skeleton className="h-8 w-24" />;

  // Not signed in via email but past the AuthGate means an external wallet
  // is connected. The welcome screen owns sign-in, so the header shows the
  // wallet pill plus the rewards chip; the chip opens the tea service.
  if (!privy.authenticated) return <ExternalAccountEntry />;

  const email = privy.user?.email?.address;
  const address = privy.embedded?.address;

  return (
    <>
      {/* The one header pill for email users: the shared rank chip wearing
          the signed-in dot. The address book belongs inside the pantry,
          where the email already reads in full. */}
      <RankChip
        onClick={() => setAccountOpen(true)}
        presence
        placeholder="Pantry"
        ariaPrefix="Your pantry"
        ariaSuffix={email ? `signed in as ${email}` : "signed in"}
      />

      <Drawer open={accountOpen} onOpenChange={setAccountOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Your pantry</DrawerTitle>
            <DrawerDescription>
              {email ? `Signed in as ${email}` : "Signed in via email"}
            </DrawerDescription>
          </DrawerHeader>

          <div className="flex flex-col gap-2 p-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
            <TeaService />
            {address ? (
              <>
                <ReceiveRow
                  title="EVM address"
                  description="One address for Ethereum, Base, Arbitrum, Polygon, BNB and every other EVM network."
                  address={address}
                  copyToast="Works on every EVM network SODAX supports. Send funds there to top up."
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

            {/* No external-wallet affordance here on purpose: email users
                live entirely in the teapot. The expert path stays on the
                welcome screen for people who skip Privy. */}

            {/* The back room — modes and currency. Drawers don't stack, so
                the pantry hands over: close this one, open that one. */}
            <button
              type="button"
              onClick={() => {
                setAccountOpen(false);
                setSettingsOpen(true);
              }}
              className="flex min-h-14 items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-left transition-[transform,background-color] duration-150 ease-lift hover:bg-muted active:scale-[0.99] active:bg-muted"
            >
              <GearSix className="size-5 text-primary" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium text-foreground">
                  {copy.settingsTitle}
                </span>
                <span className="text-xs text-muted-foreground">
                  {copy.settingsSub}
                </span>
              </div>
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

      <SettingsDrawer open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}

/**
 * Header entry for external-wallet visitors: the familiar connect pill plus
 * the rewards chip, which opens a small drawer holding the tea service
 * (rank, avatar shelf, and the email invitation with its reward).
 */
function ExternalAccountEntry() {
  const [serviceOpen, setServiceOpen] = useState(false);
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <RankChip onClick={() => setServiceOpen(true)} />
      <ConnectButton />
      <Drawer open={serviceOpen} onOpenChange={setServiceOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Your tea service</DrawerTitle>
            <DrawerDescription>
              Rewards for playing, and a face for your table.
            </DrawerDescription>
          </DrawerHeader>
          <div className="p-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
            <TeaService />
          </div>
        </DrawerContent>
      </Drawer>
    </div>
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
      title="Solana address"
      description="Only for Solana assets: SOL, JitoSOL, USDC on Solana."
      address={solanaAddress}
      copyToast="Only send Solana assets to this one."
    />
  );
}

/**
 * Friendly-labeled receive row: no raw hex in the UI (that's teapot
 * plumbing). Two actions per address — a QR that unfolds inline under the
 * row (no drawer-on-drawer), and a copy whose toast confirms the shortened
 * form so you can double-check what landed in the clipboard.
 */
function ReceiveRow({
  title,
  description,
  address,
  copyToast,
}: {
  title: string;
  description: string;
  address: string;
  copyToast: string;
}) {
  const [qrOpen, setQrOpen] = useState(false);

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex min-h-14 items-center gap-3 px-3 py-2.5">
        <Wallet className="size-5 shrink-0 text-primary" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-medium text-foreground">{title}</span>
          <span className="text-xs text-muted-foreground">{description}</span>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Show ${title} as QR code`}
          aria-expanded={qrOpen}
          className="shrink-0 text-muted-foreground hover:text-foreground"
          onClick={() => setQrOpen((open) => !open)}
        >
          <QrCode className="size-4.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Copy ${title}`}
          className="shrink-0 text-muted-foreground hover:text-foreground"
          onClick={() => {
            void navigator.clipboard.writeText(address);
            toast.success("Address copied", {
              description: `${shortenAddress(address, 6)} · ${copyToast}`,
            });
          }}
        >
          <Copy className="size-4.5" />
        </Button>
      </div>

      <AnimatePresence initial={false}>
        {qrOpen && (
          <motion.div
            key="qr"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={SPRING_SHELF}
            className="overflow-hidden"
          >
            <div className="flex flex-col items-center gap-2 px-3 pb-3">
              {/* White tile regardless of mode: QR codes need contrast, not
                  theming. */}
              <div className="rounded-lg bg-white p-2">
                <QRCodeSVG value={address} size={132} marginSize={1} />
              </div>
              <span className="money text-[11px] text-muted-foreground">
                {shortenAddress(address, 8)}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
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
      className="flex min-h-14 items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-left transition-[transform,background-color] duration-150 ease-lift hover:bg-muted active:scale-[0.99] active:bg-muted"
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
