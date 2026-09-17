"use client";

import { useMemo } from "react";
import { useXConnectorsByChain, type IXConnector } from "@sodax/wallet-sdk-react";
import { useMounted } from "@/hooks/use-mounted";
import { pickInstalledWallets, type InstalledWallet } from "@/lib/installed-wallets";

export type InstalledWallets = {
  /** False on the server and during hydration: detection reads `window`. */
  ready: boolean;
  /** One row per wallet found in this browser, best family first. */
  wallets: InstalledWallet<IXConnector>[];
};

/**
 * The wallets this browser has. Detection is the SDK's own (`isInstalled`
 * reads `window.*` at access time: EIP-6963 announcements for EVM, the
 * wallet standard for Solana, injected objects for Bitcoin and Stellar), so
 * a wallet's in-app browser on a phone shows up exactly like an extension on
 * a desktop. Mounted-gated: the server render offers nothing, and the offer
 * arrives with hydration, never as a flash of the wrong screen.
 */
export function useInstalledWallets(): InstalledWallets {
  const mounted = useMounted();
  const byChain = useXConnectorsByChain();
  const wallets = useMemo(
    () => (mounted ? pickInstalledWallets(byChain) : []),
    [mounted, byChain],
  );
  return { ready: mounted, wallets };
}
