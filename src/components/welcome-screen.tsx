"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Wallet } from "@phosphor-icons/react";
import { toast } from "@/lib/toast";
import { isUserRejectedError } from "@sodax/dapp-kit";
import {
  useConnectedChains,
  useXConnect,
  type IXConnector,
} from "@sodax/wallet-sdk-react";
import { Button } from "@/components/ui/button";
import { ThinkingOrb } from "@/components/ui/thinking-orb";
import { clearDrawerReturn } from "@/components/account-drawer-nav";
import { BerthMark } from "@/components/berth-mark";
import { PILL, WelcomePage } from "@/components/welcome/welcome-page";
import { cn } from "@/lib/utils";
import { WalletDrawer } from "@/components/wallet";
import { PRIVY_ENABLED } from "@/components/privy-provider";
import { useInterruptedMerge, useLinkInProgress } from "@/hooks/use-link-email";
import { useStaffSignInRunning } from "@/components/staff/entry";
import { usePrivyEmbeddedWallet } from "@/hooks/use-privy-evm-wallet";
import { useCopy } from "@/components/settings-provider";
import { COPY } from "@/lib/copy";
import { useMounted } from "@/hooks/use-mounted";
import { useWalletRestore } from "@/hooks/use-wallet-restore";
import { useInstalledWallets } from "@/hooks/use-installed-wallets";
import type { InstalledWallet } from "@/lib/installed-wallets";
import { pendingReferralCode } from "@/lib/referral";
import { NotHereCard, useAvailability } from "@/components/availability/availability";
import { useRefusedForSanctions } from "@/lib/unavailable-refusal";


/**
 * Web2-style front door: one universal login screen for anyone who is
 * neither signed in via email nor connected with an external wallet. The
 * account renders only once the user is in, so "Sign in" and "Connect"
 * never compete for the first action.
 */
export function AuthGate({
  children,
  lead,
}: {
  children: ReactNode;
  /**
   * Said instead of the usual welcome line when the visitor came for one
   * thing, such as connecting an assistant (app/oauth/authorize).
   */
  lead?: string;
}) {
  const privy = usePrivyEmbeddedWallet();
  const connected = useConnectedChains();
  const linking = useLinkInProgress();
  // The Staff entry's email sign in holds its session until the page goes to /staff (components/staff/entry).
  const staffSignIn = useStaffSignInRunning();
  const copy = useCopy();
  const refusedForSanctions = useRefusedForSanctions();
  const mergeInterrupted = useCallback(() => toast(copy.mergeInterrupted), [copy.mergeInterrupted]);
  useInterruptedMerge(mergeInterrupted);

  // A Privy session belonging to a wallet account is only ever scaffolding
  // for adding an email (hooks/use-link-email). Found outside that flow it
  // is either left over from an interrupted one, or someone signed in with
  // the email of a wallet account; neither has a screen here, because the
  // money is on a wallet this browser may not hold. End it, and say why when
  // there is no wallet to fall back on.
  const stray = PRIVY_ENABLED && privy.ready && privy.walletAccountSession && !linking && !staffSignIn;
  const { logout } = privy;
  const noWallet = connected.status !== "loading" && connected.total === 0;
  useEffect(() => {
    if (!stray) return;
    logout()
      .then(() => {
        if (noWallet) toast(copy.walletAccountEmailSignIn);
      })
      .catch(() => {
        // Privy keeps the session; the next render tries again.
      });
  }, [stray, logout, noWallet, copy.walletAccountEmailSignIn]);

  // A wallet sign in survives a refresh on its pocketed session while the
  // extension reconnects (lib/wallet-restore): the splash while Berth tries
  // quietly, then the account, on the session alone if the wallet stays
  // away. Never the welcome page to someone signed in.
  const restore = useWalletRestore();
  const emailIn = PRIVY_ENABLED && privy.authenticated && !privy.walletAccountSession;
  const settling =
    (PRIVY_ENABLED && !privy.ready) ||
    connected.status === "loading" ||
    stray ||
    (!emailIn && connected.total === 0 && restore.phase === "restoring");
  const isIn = emailIn || connected.total > 0 || restore.phase === "session";

  // Signed out, there is no drawer to come back to (lib/drawer-return):
  // a copied ?account= address must not open one after sign in.
  const out = !settling && !isIn;
  useEffect(() => {
    if (out) clearDrawerReturn();
  }, [out]);

  // A comprehensively sanctioned place gets the public page and nothing
  // else, signed in or not (lib/server/availability refuseSanctioned): the
  // traveller's exception is for the United States alone.
  const availability = useAvailability();
  const sanctioned = (!availability.available && availability.reason === "sanctions") || refusedForSanctions;
  if (sanctioned) return <WelcomeScreen lead={lead} sanctioned />;
  if (settling) return <Splash />;
  if (!isIn) return <WelcomeScreen lead={lead} />;
  return <>{children}</>;
}

/**
 * Quiet moment while sessions rehydrate; no flash of the wrong screen. The
 * mark's dot is a breathing orb while this lasts, drawn at 64px so one unit
 * of the mark is one pixel and the 20px orb centres on the dot (32, 30).
 * Until the orb's code arrives, and on the server, the still dot stands in.
 */
export function Splash() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-2">
      <span className="relative size-16">
        <BerthMark className="size-16" hollow />
        <ThinkingOrb
          state="breathing"
          size={20}
          dotSize={1.6}
          decorative
          className="absolute top-[20px] left-[22px]"
          fallback={<span className="size-3 rounded-full bg-foreground" />}
        />
      </span>
      <span className="sr-only">{COPY.loadingLabel}</span>
    </div>
  );
}

function WelcomeScreen({ lead, sanctioned = false }: { lead?: string; sanctioned?: boolean }) {
  const privy = usePrivyEmbeddedWallet();
  const [walletsOpen, setWalletsOpen] = useState(false);
  // localStorage read, so mounted-gated: the server render must not guess.
  const mounted = useMounted();
  const invited = mounted && pendingReferralCode() !== null;
  const signIn = PRIVY_ENABLED ? privy.login : () => setWalletsOpen(true);
  // Where Berth is not available (lib/availability) the way in becomes the
  // soft landing. Sign in stays, for an account that already exists: the
  // server finds it as always and makes no new one.
  const pageAvailability = useAvailability();
  const availability = sanctioned ? ({ available: false, reason: "sanctions" } as const) : pageAvailability;

  return (
    <>
      <WelcomePage
        lead={lead}
        invited={invited}
        // Where Berth is not available the card holds every way in (email
        // and each wallet); the bar's Sign in leads there, not to email alone.
        onSignIn={
          sanctioned
            ? undefined
            : availability.available
              ? signIn
              : () => document.getElementById("not-here-sign-in")?.scrollIntoView({ behavior: "smooth", block: "center" })
        }
        notice={
          availability.available ? undefined : (
            <NotHereCard
              availability={availability}
              welcomeHref="#how"
              signIn={sanctioned ? undefined : <WayIn quiet onEmail={privy.login} onWallets={() => setWalletsOpen(true)} />}
            />
          )
        }
        ctas={() => <WayIn onEmail={privy.login} onWallets={() => setWalletsOpen(true)} />}
      />
      <WalletDrawer open={walletsOpen} onOpenChange={setWalletsOpen} />
    </>
  );
}

/**
 * The way in, as two pills: email, filled in the accent, and beside it a
 * ghost pill for each wallet this browser actually has, connecting its best
 * family in one tap. Nothing is offered when nothing is installed: a phone
 * without a wallet sees email alone, a wallet's in-app browser sees itself.
 * A connected wallet passes the gate above, so success needs no handling
 * here; the SDK's store flips and the account renders. Without Privy the
 * filled pill opens the wallet drawer instead.
 */
function WayIn({
  onEmail,
  onWallets,
  quiet = false,
}: {
  onEmail: () => void;
  onWallets: () => void;
  /**
   * Inside the landing's card, for an account that already exists: every
   * pill a ghost (nothing in the accent), and "Connect a wallet" always
   * offered, so a wallet only account whose wallet this browser does not
   * detect can still reach the wallet drawer.
   */
  quiet?: boolean;
}) {
  const copy = useCopy();
  const { wallets } = useInstalledWallets();
  const connect = useXConnect();
  const [pending, setPending] = useState<string | null>(null);

  const pick = async (wallet: InstalledWallet<IXConnector>) => {
    setPending(wallet.name);
    try {
      await connect.mutateAsync(wallet.primary);
    } catch (error) {
      // A dismissed prompt is a decision, not a failure.
      if (!isUserRejectedError(error)) toast.error(copy.walletConnectFailed);
    } finally {
      setPending(null);
    }
  };

  const filled =
    "h-12 rounded-full px-[22px] text-[14.5px] font-medium sm:h-11";
  const size = quiet ? "h-10 px-4 text-[13.5px]" : "h-12 px-[22px] text-[14.5px] sm:h-11";
  const first = PRIVY_ENABLED
    ? { label: copy.welcomePage.emailCta, onClick: onEmail }
    : { label: copy.connectWallet, onClick: onWallets };
  return (
    <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
      {quiet ? (
        <button type="button" className={cn(PILL, size)} onClick={first.onClick}>
          {first.label}
        </button>
      ) : (
        <Button className={filled} onClick={first.onClick}>
          {first.label}
        </Button>
      )}
      {PRIVY_ENABLED &&
        wallets.map((wallet) => (
          <button
            key={wallet.name}
            type="button"
            disabled={pending !== null}
            onClick={() => void pick(wallet)}
            className={cn(PILL, size, "disabled:opacity-50")}
          >
            {wallet.icon ? (
              // Wallet icons are wallet-provided URLs, often data: URIs, which
              // next/image does not take.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={wallet.icon} alt="" className="size-4 rounded-sm" />
            ) : (
              <Wallet weight="duotone" className="size-4" aria-hidden />
            )}
            {pending === wallet.name ? copy.walletConnecting(wallet.name) : copy.continueWithWallet(wallet.name)}
          </button>
        ))}
      {quiet && PRIVY_ENABLED && (
        <button type="button" className={cn(PILL, size)} onClick={onWallets}>
          <Wallet weight="duotone" className="size-4" aria-hidden />
          {copy.connectWallet}
        </button>
      )}
    </div>
  );
}
