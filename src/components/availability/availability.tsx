"use client";

import { useConnectedChains, useXDisconnect } from "@sodax/wallet-sdk-react";
import { Button } from "@/components/ui/button";
import { BerthMark } from "@/components/berth-mark";
import { useCopy } from "@/components/settings-provider";
import { usePrivyEmbeddedWallet } from "@/hooks/use-privy-evm-wallet";
import type { Availability } from "@/lib/availability";
import { forgetUnavailable } from "@/lib/unavailable-refusal";
import { ReasonLine, SupportLine } from "@/components/availability/not-here";

export { AvailabilityProvider, useAvailability } from "@/components/availability/availability-context";
export { NotHereBanner, NotHereCard, NotHereDrawer, NotHereDrawerBody } from "@/components/availability/not-here";

/**
 * A sign in the server would not make a new account for (the profile
 * route answered 451): say so, and end the session. Nothing was made.
 */
export function NoAccountHere({ availability }: { availability: Availability }) {
  const copy = useCopy().unavailable;
  const privy = usePrivyEmbeddedWallet();
  const { chains } = useConnectedChains();
  const disconnect = useXDisconnect();
  const signOut = async () => {
    if (privy.enabled && privy.authenticated) await privy.logout().catch(() => undefined);
    for (const chainType of new Set(chains.map((chain) => chain.chainType))) {
      await disconnect({ xChainType: chainType }).catch(() => undefined);
    }
    forgetUnavailable();
  };
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[34rem] flex-col items-center justify-center gap-6 px-4 py-10">
      <BerthMark className="size-10" title="Berth" />
      <section data-testid="no-account-here" className="w-full rounded-lg border border-border bg-card">
        <div className="flex flex-col gap-3 px-5 py-5 lg:px-6">
          <h1 className="font-display text-xl leading-tight tracking-[-0.02em] text-foreground">{copy.noAccountTitle}</h1>
          <p className="text-[14.5px] leading-relaxed text-foreground">{copy.noAccountBody}</p>
          <ReasonLine availability={availability} className="text-[14.5px] leading-relaxed text-muted-foreground" />
        </div>
        <div className="flex flex-col gap-3 border-t border-border px-5 py-4 lg:px-6">
          <SupportLine />
          <Button className="h-11 w-full rounded-full sm:w-fit sm:px-6" onClick={() => void signOut()}>
            {copy.signOut}
          </Button>
        </div>
      </section>
    </div>
  );
}
