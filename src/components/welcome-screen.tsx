"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Envelope, HandHeart, Wallet } from "@phosphor-icons/react";
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
import { MarketPreview, NewsFeed } from "@/components/board";
import { WalletDrawer } from "@/components/wallet";
import { PRIVY_ENABLED } from "@/components/privy-provider";
import { useLinkInProgress } from "@/hooks/use-link-email";
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
  const copy = useCopy();
  // localStorage read, so mounted-gated: the server render must not guess.
  const mounted = useMounted();
  const invited = mounted && pendingReferralCode() !== null;

  // A door, and a window. The promise used to be argued in a paragraph on a
  // centred column with most of a desktop left empty either side; now the
  // argument stands on the left and the actual board stands on the right,
  // priced and moving, because the most persuasive thing a brokerage can
  // show a visitor is the market it is offering. Both routes behind that
  // panel are public, so it is the real thing and not a mock. On a phone the
  // two stack, and the way in stays above the board.
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-8 px-6 py-10 sm:max-w-lg lg:max-w-5xl lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-center lg:gap-12 xl:max-w-7xl xl:grid-cols-[minmax(0,1fr)_minmax(0,46rem)] xl:gap-10">
      <div className="flex flex-col items-center gap-6 text-center lg:items-start lg:text-left">
      <div className="flex flex-col items-center gap-3 lg:items-start">
        <BerthMark className="size-16" title="Berth" />
        <h1 className="font-display text-3xl font-semibold tracking-[-0.02em] text-foreground lg:text-5xl">
          {copy.brand}
        </h1>
        <p className="font-display text-[15px] text-muted-foreground lg:text-lg">
          {copy.tagline}
        </p>
        <p className="max-w-80 text-sm leading-relaxed text-muted-foreground">
          {lead ?? copy.welcomeLede}
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

      <div className="flex w-full max-w-80 flex-col items-center gap-3 lg:items-start">
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
      <div className="flex flex-col items-center gap-1 lg:items-start">
        <p className="max-w-80 text-[11px] leading-relaxed text-muted-foreground">
          {copy.footerNote}
        </p>
      </div>
      </div>

      {/* The board and what is being said about it: the same live, public
          data the signed-in column reads, from the same cache, so a
          visitor costs no extra call. Under the board from 1024px, beside
          it from 1280px at exactly its height, last on a phone so the way
          in stays first. */}
      <div className="flex flex-col gap-4 xl:grid xl:grid-cols-2 xl:items-stretch xl:gap-6">
        <MarketPreview />
        <NewsFeed limit={6} fill />
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
