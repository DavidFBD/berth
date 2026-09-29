"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Wallet } from "@phosphor-icons/react";
import { toast } from "sonner";
import { isUserRejectedError } from "@sodax/dapp-kit";
import {
  useConnectedChains,
  useXConnect,
  type IXConnector,
} from "@sodax/wallet-sdk-react";
import { Button } from "@/components/ui/button";
import { ThinkingOrb } from "@/components/ui/thinking-orb";
import { BerthMark } from "@/components/berth-mark";
import { PILL, WelcomePage } from "@/components/welcome/welcome-page";
import { cn } from "@/lib/utils";
import { WalletDrawer } from "@/components/wallet";
import { PRIVY_ENABLED } from "@/components/privy-provider";
import { useInterruptedMerge, useLinkInProgress } from "@/hooks/use-link-email";
import { usePrivyEmbeddedWallet } from "@/hooks/use-privy-evm-wallet";
import { useCopy } from "@/components/settings-provider";
import { COPY } from "@/lib/copy";
import { useMounted } from "@/hooks/use-mounted";
import { useInstalledWallets } from "@/hooks/use-installed-wallets";
import type { InstalledWallet } from "@/lib/installed-wallets";
import { pendingReferralCode } from "@/lib/referral";


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
  const copy = useCopy();
  const mergeInterrupted = useCallback(() => toast(copy.mergeInterrupted), [copy.mergeInterrupted]);
  useInterruptedMerge(mergeInterrupted);

  // A Privy session belonging to a wallet account is only ever scaffolding
  // for adding an email (hooks/use-link-email). Found outside that flow it
  // is either left over from an interrupted one, or someone signed in with
  // the email of a wallet account; neither has a screen here, because the
  // money is on a wallet this browser may not hold. End it, and say why when
  // there is no wallet to fall back on.
  const stray = PRIVY_ENABLED && privy.ready && privy.walletAccountSession && !linking;
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

  const settling =
    (PRIVY_ENABLED && !privy.ready) || connected.status === "loading" || stray;
  const isIn =
    (PRIVY_ENABLED && privy.authenticated && !privy.walletAccountSession) ||
    connected.total > 0;

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

function WelcomeScreen({ lead }: { lead?: string }) {
  const privy = usePrivyEmbeddedWallet();
  const [walletsOpen, setWalletsOpen] = useState(false);
  // localStorage read, so mounted-gated: the server render must not guess.
  const mounted = useMounted();
  const invited = mounted && pendingReferralCode() !== null;
  const signIn = PRIVY_ENABLED ? privy.login : () => setWalletsOpen(true);

  return (
    <>
      <WelcomePage
        lead={lead}
        invited={invited}
        onSignIn={signIn}
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
function WayIn({ onEmail, onWallets }: { onEmail: () => void; onWallets: () => void }) {
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
  return (
    <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
      {PRIVY_ENABLED ? (
        <Button className={filled} onClick={onEmail}>
          {copy.welcomePage.emailCta}
        </Button>
      ) : (
        <Button className={filled} onClick={onWallets}>
          {copy.connectWallet}
        </Button>
      )}
      {PRIVY_ENABLED &&
        wallets.map((wallet) => (
          <button
            key={wallet.name}
            type="button"
            disabled={pending !== null}
            onClick={() => void pick(wallet)}
            className={cn(PILL, "h-12 px-[22px] text-[14.5px] disabled:opacity-50 sm:h-11")}
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
    </div>
  );
}
