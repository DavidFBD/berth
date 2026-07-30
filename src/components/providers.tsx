"use client";

import { useState, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { SodaxProvider, createSodaxQueryClient } from "@sodax/dapp-kit";
import { SodaxWalletProvider } from "@sodax/wallet-sdk-react";
import { IconContext } from "@phosphor-icons/react";
import { Toaster } from "@/components/ui/sonner";
import { AppPrivyProvider } from "@/components/privy-provider";
import { sodaxConfig, walletConfig } from "@/lib/sodax-config";

/** App-wide Phosphor default: every icon renders duotone unless overridden. */
const ICON_DEFAULTS = { weight: "duotone" as const };

export function Providers({ children }: { children: ReactNode }) {
  // useState keeps one QueryClient per app lifetime without a module-level
  // singleton leaking between server renders.
  const [queryClient] = useState(() => createSodaxQueryClient());

  return (
    <AppPrivyProvider>
      <SodaxProvider config={sodaxConfig}>
        <QueryClientProvider client={queryClient}>
          <SodaxWalletProvider config={walletConfig}>
            <IconContext.Provider value={ICON_DEFAULTS}>
              {children}
              <Toaster position="top-center" />
            </IconContext.Provider>
          </SodaxWalletProvider>
        </QueryClientProvider>
      </SodaxProvider>
    </AppPrivyProvider>
  );
}
