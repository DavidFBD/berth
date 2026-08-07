"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Envelope, HandHeart } from "@phosphor-icons/react";
import { useConnectedChains } from "@sodax/wallet-sdk-react";
import { Button } from "@/components/ui/button";
import { WalletDrawer } from "@/components/wallet";
import { CupArt, SteamPlume } from "@/components/tea/tea-art";
import { PRIVY_ENABLED } from "@/components/privy-provider";
import { usePrivyEmbeddedWallet } from "@/hooks/use-privy-evm-wallet";
import { useCopy } from "@/components/settings-provider";
import { useMounted } from "@/hooks/use-mounted";
import { pendingReferralCode } from "@/lib/referral";

/* eslint-disable @next/next/no-img-element -- tiny local brand mark */

/**
 * Web2-style front door: one universal login screen for anyone who is
 * neither signed in via email nor connected with an external wallet. The
 * tea table renders only once the user is in, so "Sign in" and "Connect"
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
      <SteamPlume level={1} width={54} height={30} />
      <img src="/lsteatime-mark.svg" alt="" aria-hidden width={56} height={56} />
    </div>
  );
}

const CUPS = [
  { cup: "earlgrey", fill: 0.65, level: 2, bowl: false },
  { cup: "breakfast", fill: 0.82, level: 3, bowl: false },
  { cup: "sencha", fill: 0.4, level: 2, bowl: true },
] as const;

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
        <img src="/lsteatime-mark.svg" alt="LSTeaTime" width={64} height={64} />
        <h1 className="font-display text-3xl text-foreground">LSTeaTime</h1>
        <p className="max-w-70 text-[15px] leading-relaxed text-muted-foreground">
          {copy.tagline}
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

      {/* The three blends, warmed and waiting */}
      <div className="flex items-end gap-4">
        {CUPS.map(({ cup, fill, level, bowl }) => (
          <div key={cup} className="flex flex-col items-center">
            <SteamPlume level={level} width={56} height={36} />
            <CupArt
              accent={`var(--cup-${cup})`}
              deep={`var(--cup-${cup}-deep)`}
              fill={fill}
              bowl={bowl}
              size={64}
            />
          </div>
        ))}
      </div>

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
        {PRIVY_ENABLED && (
          <button
            type="button"
            onClick={() => setWalletsOpen(true)}
            className="hidden py-1 text-xs font-bold text-muted-foreground transition-colors hover:text-foreground lg:block"
          >
            {copy.preferOwnWallet}
          </button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {copy.mottoLead}{" "}
        <span className="font-display text-foreground/70">
          {copy.mottoDisplay}
        </span>
      </p>

      <Link
        href="/lore"
        className="text-[11px] text-muted-foreground underline decoration-border underline-offset-2 transition-colors hover:text-foreground"
      >
        {copy.loreLink}
      </Link>

      <WalletDrawer open={walletsOpen} onOpenChange={setWalletsOpen} />
    </div>
  );
}
