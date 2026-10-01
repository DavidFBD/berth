"use client";

import { useEffect, useState } from "react";
import type { AssistantId } from "@/lib/assistant-party";
import { toast } from "sonner";
import { useLinkInProgress } from "@/hooks/use-link-email";
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
import { Panel } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { ConnectButton } from "@/components/wallet";
import { SettingsDrawer } from "@/components/settings-drawer";
import { EmailSection } from "@/components/email-section";
import { AssistantSection } from "@/components/assistant/assistant-section";
import { WalletsSection } from "@/components/account-wallets";
import { SocialSection } from "@/components/social/social-section";
import { RecurringSection } from "@/components/recurring/recurring-section";
import { RankChip, RewardsPanel } from "@/components/rewards-panel";
import { ADD_EMAIL_ANCHOR } from "@/components/social/social-section";
import { useCopy } from "@/components/settings-provider";
import { useMounted } from "@/hooks/use-mounted";
import { useAccountWallets } from "@/hooks/use-profile";
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
  assistant = null,
  focusEmail = false,
}: {
  /** Optional controlled open state so the page (the funds module's top-up button) can open the account drawer. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Opened from the board's "Your assistant" card: that assistant's steps, scrolled to. */
  assistant?: AssistantId | null;
  /** Opened from the email nudge: the add-email row, scrolled to. */
  focusEmail?: boolean;
} = {}) {
  const privy = usePrivyEmbeddedWallet();
  const linking = useLinkInProgress();
  const mounted = useMounted();
  const copy = useCopy();
  const [accountOpenState, setAccountOpenState] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const accountOpen = openProp ?? accountOpenState;
  const setAccountOpen = onOpenChange ?? setAccountOpenState;
  useScrollToAssistant(accountOpen && assistant !== null);
  useScrollToAddEmail(accountOpen && focusEmail);

  if (!PRIVY_ENABLED) return <ConnectButton />;

  if (!privy.ready) return <Skeleton className="h-8 w-24" />;

  // Not signed in via email but past the AuthGate means an external wallet
  // is connected. The welcome screen owns sign-in, so the header shows the
  // wallet pill plus the rewards chip; the chip opens the rewards panel.
  // A wallet account stays a wallet account while it borrows a Privy
  // session to add an email, and after: the email drawer below assumes an
  // embedded wallet this person does not have. See hooks/use-link-email.
  if (!privy.authenticated || linking || privy.walletAccountSession) {
    return <ExternalAccountEntry open={accountOpen} onOpenChange={setAccountOpen} assistant={assistant} />;
  }

  const email = privy.user?.email?.address;
  const address = privy.embedded?.address;

  return (
    <>
      {/* The one header pill for email users: the shared rank chip wearing
          the signed-in dot. The address book belongs inside the account
          drawer, where the email already reads in full. */}
      <RankChip
        onClick={() => setAccountOpen(true)}
        presence
        placeholder={copy.accountTotalLabel}
        ariaPrefix={copy.accountTotalLabel}
        ariaSuffix={email ? `signed in as ${email}` : "signed in"}
      />

      <Drawer open={accountOpen} onOpenChange={setAccountOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{copy.accountTotalLabel}</DrawerTitle>
            <DrawerDescription>
              {email ? copy.accountSignedInAs(email) : copy.accountSignedInEmail}
            </DrawerDescription>
          </DrawerHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-4 *:shrink-0 pb-[max(env(safe-area-inset-bottom),1rem)]">
            <RewardsPanel />
            {/* Username, profile and friends (lib/server/social). */}
            <Panel>
              <SocialSection />
            </Panel>
            {/* Recurring buys (lib/recurring): reminders the person signs. */}
            <Panel>
              <RecurringSection onLeave={() => setAccountOpen(false)} />
            </Panel>
            {/*
              One panel with ruled rows, not five cards stacked inside a
              drawer that is already a card. Every row here is the same kind
              of thing, somewhere to go or something to copy, and giving each
              its own border made a drawer that read as a list of boxes.
            */}
            <WalletsSection />
            <Panel className="divide-y divide-border">
            {address ? (
              <>
                <ReceiveRow
                  title={copy.receiveEvmTitle}
                  description={copy.receiveEvmBody}
                  address={address}
                  copyToast={copy.receiveEvmToast}
                />
                {/* Privy's /solana hooks are not SSR-safe — client-only. */}
                {mounted && <SolanaReceive />}
              </>
            ) : (
              <p className="px-3 py-3 text-sm text-muted-foreground">
                {copy.ctaOpeningAccount}
              </p>
            )}

            {address && <FundButton address={address} />}

            {/* An assistant that reads the account and drafts orders the
                person signs here (app/mcp). */}
            {address && (
              <div id={ASSISTANT_ANCHOR} className="scroll-mt-4">
                <AssistantSection initialOpen={assistant} />
              </div>
            )}

            {/* No external-wallet CONNECT affordance here on purpose: email
                users live entirely in Funds, and the expert path stays on
                the welcome screen for people who skip Privy. Getting funds
                OUT is a different question, and the row above is the
                answer to it. */}

            {/* The back room — appearance and currency. Drawers don't stack,
                so the account drawer hands over: close this one, open that
                one. */}
            <button
              type="button"
              onClick={() => {
                setAccountOpen(false);
                setSettingsOpen(true);
              }}
              className="flex min-h-14 w-full items-center gap-3 px-3 py-3 text-left transition-[background-color] duration-150 ease-lift hover:bg-muted/60 active:bg-muted"
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
            </Panel>

            <Button
              variant="ghost"
              className="justify-start gap-3 px-3 text-muted-foreground"
              onClick={() => {
                setAccountOpen(false);
                void privy.logout();
              }}
            >
              <SignOut className="size-5" />
              {copy.accountSignOut}
            </Button>
          </div>
        </DrawerContent>
      </Drawer>

      <SettingsDrawer
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        evmAddress={mounted ? address : undefined}
      />
    </>
  );
}

/**
 * Whether the account drawer carries "Your assistant" for this session,
 * by the same rule the drawer itself follows below: a wallet account's
 * drawer always does, an email account's once its address exists, and
 * without Privy there is no drawer at all. The board shows its card only
 * then, so the card never opens a drawer that lacks what it promised.
 */
export function useAssistantReachable(): boolean {
  const privy = usePrivyEmbeddedWallet();
  const linking = useLinkInProgress();
  if (!PRIVY_ENABLED || !privy.ready) return false;
  if (!privy.authenticated || linking || privy.walletAccountSession) return true;
  return Boolean(privy.embedded?.address);
}

/**
 * Whether this is an email account's session, decided from the session
 * itself, never from whether its embedded wallet exists yet: on a first
 * sign in that wallet is made a moment after login, and in between the
 * person is still an email account. A wallet account pays from the wallet
 * it connected, so the home offers it the board instead of Add money.
 */
export function useEmailSession(): boolean {
  const privy = usePrivyEmbeddedWallet();
  const linking = useLinkInProgress();
  if (!PRIVY_ENABLED || !privy.ready || !privy.authenticated) return false;
  return !linking && !privy.walletAccountSession;
}

/**
 * "Add money", on its own: how to pay, and nothing else. The same rows the
 * account drawer carries (Privy's funding flow for card and bank, and the
 * account's own addresses to send crypto to), so a new account's first
 * step is one tap and one choice rather than a search through the drawer.
 */
export function AddMoneyDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const privy = usePrivyEmbeddedWallet();
  const mounted = useMounted();
  const copy = useCopy();
  const address = privy.embedded?.address;
  // A Bitcoin wallet linked to the account can receive too; it is the
  // person's own, so sending Bitcoin there is adding money they can pay with.
  const linked = useAccountWallets();
  const bitcoin = linked.data?.wallets.find((wallet) => wallet.family === "bitcoin")?.address;
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{copy.calmHome.addMoneyTitle}</DrawerTitle>
          <DrawerDescription>{copy.calmHome.addMoneySub}</DrawerDescription>
        </DrawerHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-4 *:shrink-0 pb-[max(env(safe-area-inset-bottom),1rem)]">
          <Panel className="divide-y divide-border">
            {address ? (
              <>
                <FundButton address={address} title={copy.calmHome.cardRowTitle} />
                <ReceiveRow
                  title={copy.receiveEvmTitle}
                  description={copy.receiveEvmBody}
                  address={address}
                  copyToast={copy.receiveEvmToast}
                />
                {mounted && <SolanaReceive />}
                {bitcoin && (
                  <ReceiveRow
                    title={copy.receiveBitcoinTitle}
                    description={copy.receiveBitcoinBody}
                    address={bitcoin}
                    copyToast={copy.receiveBitcoinToast}
                  />
                )}
              </>
            ) : (
              <p className="px-3 py-3 text-sm text-muted-foreground">{copy.ctaOpeningAccount}</p>
            )}
          </Panel>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

/** Where the board's "Your assistant" card lands inside the drawer. */
const ASSISTANT_ANCHOR = "account-assistant";

/**
 * Once the drawer has slid up, bring "Your assistant" into view. The
 * drawer's content mounts on open, so the anchor is looked up after it.
 */
function useScrollToAssistant(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => {
      document.getElementById(ASSISTANT_ANCHOR)?.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 360);
    return () => clearTimeout(timer);
  }, [active]);
}

/**
 * Opened from the email nudge: bring the add-email row (inside RewardsPanel)
 * into view, the same way "Your assistant" is scrolled to above.
 */
function useScrollToAddEmail(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => {
      document.getElementById(ADD_EMAIL_ANCHOR)?.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 360);
    return () => clearTimeout(timer);
  }, [active]);
}

/**
 * Header entry for external-wallet visitors: the familiar connect pill plus
 * the rewards chip, which opens a small drawer holding the rewards panel
 * (rank, avatar grid, and the email invitation with its reward).
 */
/**
 * A wallet user's header: rank chip, wallet pill, and the account drawer the
 * chip opens (rewards, then "Your assistant", so it is titled for both). It honours the same open state the page passes AccountButton,
 * so "Open account" in the nudge line opens this drawer for a wallet user
 * rather than an email drawer that is never rendered for them (it did
 * nothing at all until 2026-09-22).
 */
function ExternalAccountEntry({
  open: serviceOpen,
  onOpenChange: setServiceOpen,
  assistant,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assistant: AssistantId | null;
}) {
  const copy = useCopy();
  return (
    <div data-wallet-pill className="flex min-w-0 items-center gap-1.5">
      <RankChip onClick={() => setServiceOpen(true)} />
      <ConnectButton />
      <Drawer open={serviceOpen} onOpenChange={setServiceOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{copy.walletAccountDrawerTitle}</DrawerTitle>
            <DrawerDescription>{copy.walletAccountDrawerSub}</DrawerDescription>
          </DrawerHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-4 *:shrink-0 pb-[max(env(safe-area-inset-bottom),1rem)]">
            <RewardsPanel />
            <WalletsSection />
            <Panel>
              <SocialSection />
            </Panel>
            {/* Recurring buys (lib/recurring): reminders the person signs. */}
            <Panel>
              <RecurringSection onLeave={() => setServiceOpen(false)} />
            </Panel>
            <Panel>
              <EmailSection heading="row" />
            </Panel>
            <Panel>
              <div id={ASSISTANT_ANCHOR} className="scroll-mt-4">
                <AssistantSection initialOpen={assistant} />
              </div>
            </Panel>
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

/**
 * The embedded Solana wallet's address, or undefined when Privy hasn't
 * surfaced one. Duck-typed: the d.ts exports PrivyStandardWallet but the
 * runtime module doesn't (Privy build mismatch), so check the class's getter
 * directly. Stated once because two rows ask it now, and a row that
 * disagreed about which wallet is ours would export the wrong key.
 */
function usePrivySolanaAddress(): string | undefined {
  const { wallets } = useSolanaWallets();
  return wallets.find(
    (wallet) =>
      (wallet.standardWallet as { isPrivyWallet?: boolean }).isPrivyWallet ===
      true,
  )?.address;
}

/** Embedded Solana address row — isolated because the hook is client-only. */
function SolanaReceive() {
  const copy = useCopy();
  const solanaAddress = usePrivySolanaAddress();

  if (!solanaAddress) return null;
  return (
    <ReceiveRow
      title={copy.receiveSolanaTitle}
      description={copy.receiveSolanaBody}
      address={solanaAddress}
      copyToast={copy.receiveSolanaToast}
    />
  );
}

/**
 * Friendly-labeled receive row: no raw hex in the UI (that's funds-module
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
  const copy = useCopy();
  const [qrOpen, setQrOpen] = useState(false);

  return (
    <div>
      <div className="flex min-h-14 items-center gap-3 px-3 py-2.5">
        <Wallet className="size-5 shrink-0 text-primary" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-medium text-foreground">{title}</span>
          <span className="text-xs text-muted-foreground">{description}</span>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={copy.receiveShowQr(title)}
          aria-expanded={qrOpen}
          className="shrink-0 text-muted-foreground hover:text-foreground"
          onClick={() => setQrOpen((open) => !open)}
        >
          <QrCode className="size-4.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={copy.receiveCopyLabel(title)}
          className="shrink-0 text-muted-foreground hover:text-foreground"
          onClick={() => {
            void navigator.clipboard.writeText(address);
            toast.success(copy.receiveCopied, {
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
function FundButton({ address, title }: { address: string; title?: string }) {
  const { addFunds } = useAddFunds();
  const copy = useCopy();

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
            toast.success(copy.fundsAddedTitle, {
              description: copy.fundsAddedBody,
            });
          })
          .catch(() => {
            // Rejection includes plain user exit — stay quiet unless nothing
            // is configured, which Privy surfaces inside its own modal.
          });
      }}
      className="flex min-h-14 w-full items-center gap-3 px-3 py-3 text-left transition-[background-color] duration-150 ease-lift hover:bg-muted/60 active:bg-muted"
    >
      <PlusCircle className="size-5 text-primary" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium text-foreground">{title ?? copy.topUp}</span>
        <span className="text-xs text-muted-foreground">{copy.topUpSub}</span>
      </div>
    </button>
  );
}
