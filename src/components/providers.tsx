"use client";

import { useState, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { SodaxProvider, createSodaxQueryClient } from "@sodax/dapp-kit";
import { SodaxWalletProvider } from "@sodax/wallet-sdk-react";
import { Toaster } from "@/components/ui/sonner";
import { sodaxConfig, walletConfig } from "@/lib/sodax-config";

export function Providers({ children }: { children: ReactNode }) {
  // useState keeps one QueryClient per app lifetime without a module-level
  // singleton leaking between server renders.
  const [queryClient] = useState(() => createSodaxQueryClient());

  return (
    <SodaxProvider config={sodaxConfig}>
      <QueryClientProvider client={queryClient}>
        <SodaxWalletProvider config={walletConfig}>
          {children}
          <Toaster position="top-center" />
        </SodaxWalletProvider>
      </QueryClientProvider>
    </SodaxProvider>
  );
}
