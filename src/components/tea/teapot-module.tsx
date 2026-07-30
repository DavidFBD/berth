"use client";

import { Button } from "@/components/ui/button";
import { SteamPlume, TeapotArt } from "@/components/tea/tea-art";
import { usePrivyEmbeddedWallet } from "@/hooks/use-privy-evm-wallet";

/**
 * The teapot header module — idle funds waiting to be poured. Balance
 * aggregation across every chain is a later pass; for now the pot speaks to
 * the account state: sign in, or top up via the pantry.
 */
export function TeapotModule({ onTopUp }: { onTopUp: () => void }) {
  const privy = usePrivyEmbeddedWallet();
  const signedIn = privy.enabled && privy.authenticated;

  return (
    <div className="flex items-center gap-3.5 rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
      <div className="flex shrink-0 flex-col items-center">
        <SteamPlume level={signedIn ? 1 : 0} width={54} height={26} />
        <TeapotArt size={56} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11.5px] font-bold tracking-(--tracking-caps) uppercase text-muted-foreground">
          Your teapot
        </div>
        <div className="mt-0.5 text-[13px] text-muted-foreground">
          {signedIn
            ? "Send anything from ~200 assets across 20 networks. It waits here."
            : "Sign in and the pot warms itself. Email is all it takes."}
        </div>
      </div>
      <Button
        variant="secondary"
        className="h-11 shrink-0 rounded-full px-4 text-[13.5px] font-bold"
        onClick={signedIn ? onTopUp : privy.login}
      >
        {signedIn ? "Top up" : "Sign in"}
      </Button>
    </div>
  );
}
