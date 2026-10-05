"use client";

import { useEffect, useRef, useState } from "react";
import type { AssistantId } from "@/lib/assistant-party";
import { toast } from "@/lib/toast";
import { useLinkInProgress } from "@/hooks/use-link-email";
import { useStaffSignInRunning } from "@/components/staff/entry";
import { AnimatePresence, motion } from "motion/react";
import { useWallets as useSolanaWallets } from "@privy-io/react-auth/solana";
import { QRCodeSVG } from "qrcode.react";
import {
  Copy,
  PlusCircle,
  QrCode,
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
import { RankChip } from "@/components/rewards-panel";
import { ADD_EMAIL_ANCHOR } from "@/components/social/social-section";
import { useCopy } from "@/components/settings-provider";
import { ArrivalPanel, useAddMoney } from "@/components/funding-handoff";
import type { ArrivalView } from "@/lib/funding-handoff";
import { useMounted } from "@/hooks/use-mounted";
import { useAccountWallets } from "@/hooks/use-profile";
import { PRIVY_ENABLED } from "@/components/privy-provider";
import { usePrivyEmbeddedWallet } from "@/hooks/use-privy-evm-wallet";
import { shortenAddress } from "@/lib/format";
import { SPRING_SHELF } from "@/lib/motion";
import { useSignOut } from "@/hooks/use-wallet-restore";
import { AccountDrawerScreens } from "@/components/account-drawer";
import type { DrawerView } from "@/components/account-drawer-nav";
import { DRAWER_RETURN_KEY, DRAWER_RETURN_PARAM, NO_RETURN, initialScreen, readMark, resolveReturn, type ReturnState } from "@/lib/drawer-return";

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
  focusFriends = false,
}: {
  /** Optional controlled open state so the page (the funds module's top-up button) can open the account drawer. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Opened from the board's "Your assistant" card: that assistant's steps, scrolled to. */
  assistant?: AssistantId | null;
  /** Opened from the email nudge: the add-email row, scrolled to. */
  focusEmail?: boolean;
  /** Opened from the social notice: the profile and friends screen. */
  focusFriends?: boolean;
} = {}) {
  const privy = usePrivyEmbeddedWallet();
  const linking = useLinkInProgress();
  const staffSignIn = useStaffSignInRunning();
  const mounted = useMounted();
  const signOut = useSignOut();
  const copy = useCopy();
  const [accountOpenState, setAccountOpenState] = useState(false);
  const accountOpen = openProp ?? accountOpenState;
  const setAccountOpen = onOpenChange ?? setAccountOpenState;
  useScrollToAddEmail(accountOpen && focusEmail);
  // Back from a friend's profile opened in the drawer: open again, on that screen.
  const pending = useDrawerReturn(() => setAccountOpen(true), accountOpen);
  const start = initialScreen({ assistant: assistant !== null, focusEmail, friends: focusFriends, pending });

  if (!PRIVY_ENABLED) return <ConnectButton />;

  if (!privy.ready) return <Skeleton className="h-8 w-24" />;

  // Not signed in via email but past the AuthGate means an external wallet
  // is connected. The welcome screen owns sign-in, so the header shows the
  // wallet pill plus the rewards chip; the chip opens the rewards panel.
  // A wallet account stays a wallet account while it borrows a Privy
  // session to add an email, and after: the email drawer below assumes an
  // embedded wallet this person does not have. See hooks/use-link-email.
  // So does a wallet sign in while its Staff entry signs in by email on the way to /staff (components/staff/entry).
  if (!privy.authenticated || linking || staffSignIn || privy.walletAccountSession) {
    return <ExternalAccountEntry open={accountOpen} onOpenChange={setAccountOpen} assistant={assistant} start={start} focusEmail={focusEmail} />;
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
            <DrawerDescription data-ph-mask>
              {email ? copy.accountSignedInAs(email) : copy.accountSignedInEmail}
            </DrawerDescription>
          </DrawerHeader>

          <EmailDrawerBody
            address={address}
            initialView={start.view}
            returnScroll={start.scroll}
            mounted={mounted}
            assistant={assistant}
            onLeave={() => setAccountOpen(false)}
            onOpenSettings={() => {}}
            onSignOut={() => {
              setAccountOpen(false);
              // The email session, and any wallet this account linked in
              // this browser: its session would otherwise bring the same
              // account back on the next load (lib/wallet-restore).
              void signOut({ email: true });
            }}
          />
        </DrawerContent>
      </Drawer>
    </>
  );
}

/**
 * The email account drawer's body, apart from its header, so the dev
 * gallery (/dev/account?drawer=) can show it from fixtures. Its screens
 * live in components/account-drawer; what only an email account has (its
 * own addresses to receive at, and the card or bank top up) is handed in.
 */
export function EmailDrawerBody({
  address,
  mounted,
  assistant,
  initialView,
  returnScroll,
  onLeave,
  onOpenSettings,
  onSignOut,
}: {
  address?: string;
  mounted: boolean;
  assistant: AssistantId | null;
  initialView?: DrawerView;
  /** Back from a page the drawer opened: where that screen's scroll stood. */
  returnScroll?: number | null;
  onLeave: () => void;
  /** Kept for callers of the earlier shape; Settings is a screen of the drawer now. */
  onOpenSettings: () => void;
  onSignOut: () => void;
}) {
  const copy = useCopy();
  return (
    <AccountDrawerScreens
      kind="email"
      hasAddress={Boolean(address)}
      initialView={initialView}
      returnScroll={returnScroll}
      assistant={assistant}
      onLeave={onLeave}
      onOpenSettings={onOpenSettings}
      settingsAddress={mounted ? address : undefined}
      onSignOut={onSignOut}
      money={
        <Panel className="divide-y divide-border">
          {address ? (
            <>
              <FundButton address={address} surface="account" />
              <ReceiveRow
                title={copy.receiveEvmTitle}
                description={copy.receiveEvmBody}
                address={address}
                copyToast={copy.receiveEvmToast}
              />
              {/* Privy's /solana hooks are not SSR-safe, client only. */}
              {mounted && <SolanaReceive />}
            </>
          ) : (
            <p className="px-3 py-3 text-sm text-muted-foreground">{copy.ctaOpeningAccount}</p>
          )}
        </Panel>
      }
    />
  );
}

/**
 * The way back from a page the drawer opened (lib/drawer-return), read once
 * on mount: with ?account=<screen> and a fresh mark for it in this tab, the
 * drawer opens there, at that scroll. The parameter leaves the address and
 * the mark is spent either way, and the screen is spent too once the drawer
 * it opened closes, so every later open starts on the first screen.
 */
function useDrawerReturn(open: () => void, isOpen: boolean): ReturnState {
  const [pending, setPending] = useState<ReturnState>(NO_RETURN);
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  });
  useEffect(() => {
    const url = new URL(window.location.href);
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(DRAWER_RETURN_KEY);
    } catch {
      // Storage refused: nothing to return to.
    }
    const result = resolveReturn({
      param: url.searchParams.get(DRAWER_RETURN_PARAM),
      mark: readMark(raw, Date.now()),
      signedIn: true,
    });
    if (result.spend || raw !== null) {
      try {
        sessionStorage.removeItem(DRAWER_RETURN_KEY);
      } catch {
        // Storage refused.
      }
    }
    if (result.strip) {
      url.searchParams.delete(DRAWER_RETURN_PARAM);
      window.history.replaceState(null, "", url);
    }
    if (!result.open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the address and the tab's storage are only readable after mount
    setPending(result.open);
    openRef.current();
  }, []);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (isOpen) {
      wasOpen.current = true;
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    setPending(NO_RETURN);
  }, [isOpen]);
  return pending;
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
export function AddMoneyDrawer({
  open,
  onOpenChange,
  arrival,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A card payment went through: the wait for its money, and what follows, in the ways to pay's place. */
  arrival?: AddMoneyArrival | null;
}) {
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
          <DrawerDescription className={arrival ? "sr-only" : undefined}>
            {arrival ? copy.funding.closeLine : copy.calmHome.addMoneySub}
          </DrawerDescription>
        </DrawerHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-4 *:shrink-0 pb-[max(env(safe-area-inset-bottom),1rem)]">
          {arrival ? (
            <Panel className="p-3">
              <ArrivalPanel
                view={arrival.view}
                target={arrival.target}
                listingName={arrival.listingName}
                onChoose={arrival.onChoose}
                onClose={() => onOpenChange(false)}
              />
            </Panel>
          ) : (
          <Panel className="divide-y divide-border">
            {address ? (
              <>
                <FundButton address={address} title={copy.calmHome.cardRowTitle} surface="add-money" />
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
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

/** What the Add money drawer shows once a card payment went through (components/funding-handoff). */
export type AddMoneyArrival = {
  view: ArrivalView;
  target: "buy" | "choose" | "none";
  listingName?: string;
  onChoose: () => void;
};

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
  start,
  focusEmail,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assistant: AssistantId | null;
  start: ReturnState;
  focusEmail: boolean;
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
          <AccountDrawerScreens
            kind="wallet"
            hasAddress
            initialView={start.view}
            returnScroll={start.scroll}
            focusEmail={focusEmail}
            assistant={assistant}
            onLeave={() => setServiceOpen(false)}
            // Settings for a wallet account too: appearance, currency and
            // the analytics switch (no key export: that needs an embedded wallet).
            onOpenSettings={() => {}}
          />
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
export function ReceiveRow({
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
    <div data-ph-block>
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

/**
 * Privy's funding window (components/funding-handoff useAddMoney): card,
 * Apple Pay and Google Pay through whichever onramps the dashboard enables,
 * landing USDC on Base, and the wait for it before the buy.
 */
function FundButton({ address, title, surface }: { address: string; title?: string; surface: string }) {
  const addMoney = useAddMoney(surface);
  const copy = useCopy();

  return (
    <button
      type="button"
      onClick={() => addMoney(address)}
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
