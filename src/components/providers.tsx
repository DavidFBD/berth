"use client";

import { useState, type ReactNode } from "react";
import { useMounted } from "@/hooks/use-mounted";
import { QueryClientProvider } from "@tanstack/react-query";
import { SodaxProvider, createSodaxQueryClient } from "@sodax/dapp-kit";
import { SodaxWalletProvider } from "@sodax/wallet-sdk-react";
import { IconContext } from "@phosphor-icons/react";
import { Toaster } from "@/components/ui/sonner";
import { AppPrivyProvider, PRIVY_ENABLED } from "@/components/privy-provider";
import { PrivySolanaBridge } from "@/components/privy-solana-bridge";
import { sodaxConfig, walletConfig } from "@/lib/sodax-config";

/** App-wide Phosphor default: every icon renders duotone unless overridden. */
const ICON_DEFAULTS = { weight: "duotone" as const };

export function Providers({ children }: { children: ReactNode }) {
  // useState keeps one QueryClient per app lifetime without a module-level
  // singleton leaking between server renders.
  const [queryClient] = useState(() => createSodaxQueryClient());
  // Privy's /solana hooks are not SSR-safe — mount the bridge client-only.
  const mounted = useMounted();

  return (
    <AppPrivyProvider>
      <SodaxProvider config={sodaxConfig}>
        <QueryClientProvider client={queryClient}>
          <SodaxWalletProvider config={walletConfig}>
            <IconContext.Provider value={ICON_DEFAULTS}>
              {PRIVY_ENABLED && mounted && <PrivySolanaBridge />}
              {children}
              <Toaster position="top-center" />
            </IconContext.Provider>
          </SodaxWalletProvider>
        </QueryClientProvider>
      </SodaxProvider>
    </AppPrivyProvider>
  );
}
