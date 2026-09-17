"use client";

import { useState, type ReactNode } from "react";
import { Envelope, HandHeart, Wallet } from "@phosphor-icons/react";
import { toast } from "sonner";
import { isUserRejectedError } from "@sodax/dapp-kit";
import {
  useConnectedChains,
  useXConnect,
  type IXConnector,
} from "@sodax/wallet-sdk-react";
import { Button } from "@/components/ui/button";
import { BerthMark } from "@/components/berth-mark";
import { WalletDrawer } from "@/components/wallet";
import { PRIVY_ENABLED } from "@/components/privy-provider";
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
export function AuthGate({ children }: { children: ReactNode }) {
  const privy = usePrivyEmbeddedWallet();
  const connected = useConnectedChains();

  const settling =
    (PRIVY_ENABLED && !privy.ready) || connected.status === "loading";
  const isIn =
    (PRIVY_ENABLED && privy.authenticated) || connected.total > 0;

  if (settling) return <Splash />;
  if (!isIn) return <WelcomeScreen />;
  return <>{children}</>;
}

/** Quiet moment while sessions rehydrate; no flash of the wrong screen. */
function Splash() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-2">
      <BerthMark className="size-14" />
      <span className="sr-only">{COPY.loadingLabel}</span>
    </div>
  );
}

function WelcomeScreen() {
  const privy = usePrivyEmbeddedWallet();
  const [walletsOpen, setWalletsOpen] = useState(false);
  const copy = useCopy();
  // localStorage read, so mounted-gated: the server render must not guess.
  const mounted = useMounted();
  const invited = mounted && pendingReferralCode() !== null;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-6 px-6 py-10 text-center sm:max-w-lg">
      <div className="flex flex-col items-center gap-3">
        <BerthMark className="size-16" title="Berth" />
        <h1 className="font-display text-3xl font-semibold text-foreground">
          {copy.brand}
        </h1>
        <p className="text-[15px] text-muted-foreground">{copy.tagline}</p>
        <p className="max-w-80 text-sm leading-relaxed text-muted-foreground">
          {copy.welcomeLede}
        </p>
      </div>

      {/* The invitation announces itself before sign-in: name the deal
          (both sides, and WHEN it pays) while the visitor decides. */}
      {invited && (
        <div className="flex items-center gap-2.5 rounded-full border border-primary/30 bg-card px-4 py-2.5">
          <HandHeart className="size-5 shrink-0 text-primary" />
          <span className="text-sm text-foreground">{copy.inviteWaiting}</span>
        </div>
      )}

      <div className="flex w-full max-w-80 flex-col items-center gap-3">
        {PRIVY_ENABLED ? (
          <Button
            className="h-13 w-full rounded-full text-base font-bold"
            onClick={privy.login}
          >
            <Envelope className="size-5" />
            {copy.signInEmail}
          </Button>
        ) : (
          <Button
            className="h-13 w-full rounded-full text-base font-bold"
            onClick={() => setWalletsOpen(true)}
          >
            {copy.connectWallet}
          </Button>
        )}
        <p className="text-xs text-muted-foreground">{copy.noSeedPhrases}</p>
        <InstalledWalletButtons />
      </div>

      {/* The first screen carries the Berth name and nothing else's. What
          the app is built on is a fair question and it is answered in full
          under "How Berth works", not on the door. The risk line stays: it
          is about what a visitor would be buying, not about a rail. */}
      <div className="flex flex-col items-center gap-1">
        <p className="max-w-80 text-[11px] leading-relaxed text-muted-foreground">
          {copy.footerNote}
        </p>
      </div>

      <WalletDrawer open={walletsOpen} onOpenChange={setWalletsOpen} />
    </div>
  );
}

/**
 * One button per wallet this browser actually has, connecting its best
 * family in one tap. Nothing is offered when nothing is installed: a phone
 * without a wallet sees email alone, a wallet's in-app browser sees itself.
 * A connected wallet passes the gate above, so success needs no handling
 * here; the SDK's store flips and the account renders.
 */
function InstalledWalletButtons() {
  const copy = useCopy();
  const { wallets } = useInstalledWallets();
  const connect = useXConnect();
  const [pending, setPending] = useState<string | null>(null);

  if (wallets.length === 0) return null;

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

  return (
    <div className="mt-1 flex w-full flex-col items-center gap-2">
      <p className="text-xs text-muted-foreground">{copy.walletDetectedLead}</p>
      {wallets.map((wallet) => (
        <Button
          key={wallet.name}
          variant="outline"
          className="h-12 w-full rounded-full text-[15px] font-semibold"
          disabled={pending !== null}
          onClick={() => void pick(wallet)}
        >
          {wallet.icon ? (
            // Wallet icons are wallet-provided URLs, often data: URIs, which
            // next/image does not take.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={wallet.icon} alt="" className="size-5 rounded-sm" />
          ) : (
            <Wallet className="size-5" />
          )}
          {pending === wallet.name
            ? copy.walletConnecting(wallet.name)
            : copy.continueWithWallet(wallet.name)}
        </Button>
      ))}
    </div>
  );
}
