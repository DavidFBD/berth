"use client";

import { useState, type ReactNode } from "react";
import { Envelope } from "@phosphor-icons/react";
import { useConnectedChains } from "@sodax/wallet-sdk-react";
import { Button } from "@/components/ui/button";
import { WalletDrawer } from "@/components/wallet";
import { CupArt, SteamPlume } from "@/components/tea/tea-art";
import { PRIVY_ENABLED } from "@/components/privy-provider";
import { usePrivyEmbeddedWallet } from "@/hooks/use-privy-evm-wallet";

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

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-6 px-6 py-10 text-center sm:max-w-lg">
      <div className="flex flex-col items-center gap-3">
        <img src="/lsteatime-mark.svg" alt="LSTeaTime" width={64} height={64} />
        <h1 className="font-display text-3xl text-foreground">LSTeaTime</h1>
        <p className="max-w-70 text-[15px] leading-relaxed text-muted-foreground">
          A calming little game of filling up tea cups. The cups earn while
          they steep.
        </p>
      </div>

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
            Sign in with email
          </Button>
        ) : (
          <Button
            className="h-13 w-full rounded-full text-base font-bold"
            onClick={() => setWalletsOpen(true)}
          >
            Connect a wallet
          </Button>
        )}
        <p className="text-xs text-muted-foreground">
          No seed phrases, no extensions. Your pantry sets itself up.
        </p>
        {PRIVY_ENABLED && (
          <button
            type="button"
            onClick={() => setWalletsOpen(true)}
            className="hidden py-1 text-xs font-bold text-muted-foreground transition-colors hover:text-foreground lg:block"
          >
            Prefer your own wallet? Connect it instead
          </button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Tea is the way.{" "}
        <span className="font-display text-foreground/70">
          LSTeaTime is the best time.
        </span>
      </p>

      <WalletDrawer open={walletsOpen} onOpenChange={setWalletsOpen} />
    </div>
  );
}
