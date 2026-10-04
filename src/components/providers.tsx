"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useMounted } from "@/hooks/use-mounted";
import { QueryClientProvider } from "@tanstack/react-query";
import { SodaxProvider, createSodaxQueryClient } from "@sodax/dapp-kit";
import { SodaxWalletProvider } from "@sodax/wallet-sdk-react";
import { IconContext } from "@phosphor-icons/react";
import { MotionConfig } from "motion/react";
import { AppPrivyProvider, PRIVY_ENABLED } from "@/components/privy-provider";
import { SignOutSweep } from "@/components/sign-out-sweep";
import { PrivySolanaBridge } from "@/components/privy-solana-bridge";
import { SettingsProvider } from "@/components/settings-provider";
import { AnalyticsRoot } from "@/components/analytics/analytics-root";
import { WalletDiagnostics } from "@/components/dev/wallet-diagnostics";
import { WalletRestore } from "@/hooks/use-wallet-restore";
import { sodaxConfig, walletConfig } from "@/lib/sodax-config";
import { installLogCapture } from "@/lib/error-log-buffer";
import { captureReferralFromUrl, stripReferralParam } from "@/lib/referral";

// At module scope, so the buffer is recording before any provider mounts and
// misses nothing during startup. Idempotent and a no-op on the server.
installLogCapture();
// Same timing story: a friend's ?ref= code must be pocketed at first paint,
// before AuthGate hides the app behind the welcome screen.
captureReferralFromUrl();

/** App-wide Phosphor default: every icon renders duotone unless overridden. */
const ICON_DEFAULTS = { weight: "duotone" as const };

export function Providers({ children }: { children: ReactNode }) {
  // useState keeps one QueryClient per app lifetime without a module-level
  // singleton leaking between server renders.
  const [queryClient] = useState(() => createSodaxQueryClient());
  // Privy's /solana hooks are not SSR-safe — mount the bridge client-only.
  const mounted = useMounted();

  // The code is already pocketed (module scope, above); once the router has
  // hydrated it's safe to tidy the param out of the address bar.
  useEffect(() => stripReferralParam(), []);

  return (
    <AppPrivyProvider>
      <SodaxProvider config={sodaxConfig}>
        <QueryClientProvider client={queryClient}>
          <SodaxWalletProvider config={walletConfig}>
            <SettingsProvider>
            <IconContext.Provider value={ICON_DEFAULTS}>
              {/* Motion respects the OS reduce-motion preference app-wide. */}
              <MotionConfig reducedMotion="user">
                {PRIVY_ENABLED && mounted && <PrivySolanaBridge />}
                {PRIVY_ENABLED && mounted && <SignOutSweep />}
                {/* A refresh keeps a wallet sign in (lib/wallet-restore). */}
                {mounted && <WalletRestore />}
                {/* Temporary: diagnosing why localhost shows an empty wallet
                    while prod shows the same embedded wallet's holdings. */}
                {process.env.NODE_ENV !== "production" && mounted && (
                  <WalletDiagnostics />
                )}
                {children}
                {/* Product analytics: nothing loads or sends before consent. */}
                {mounted && <AnalyticsRoot />}
                {/* The toast stack is mounted by the root layout, after Providers. */}
              </MotionConfig>
            </IconContext.Provider>
            </SettingsProvider>
          </SodaxWalletProvider>
        </QueryClientProvider>
      </SodaxProvider>
    </AppPrivyProvider>
  );
}
