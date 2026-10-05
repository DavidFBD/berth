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
  const wallets = useMemo(() => {
    if (!mounted) return [];
    const found = pickInstalledWallets(byChain);
    return process.env.NODE_ENV === "production" ? found : withDevWallets(found);
  }, [mounted, byChain]);
  return { ready: mounted, wallets };
}

const DEV_WALLETS: [string, string][] = [
  ["MetaMask", "EVM"],
  ["Phantom", "EVM"],
  ["Rabby", "EVM"],
  ["Backpack", "SOLANA"],
  ["Coinbase Wallet", "EVM"],
  ["OKX Wallet", "EVM"],
  ["Solflare", "SOLANA"],
  ["Trust Wallet", "EVM"],
  ["Xverse", "BITCOIN"],
  ["Leather", "STACKS"],
  ["Unisat", "BITCOIN"],
  ["Suiet", "SUI"],
];

/**
 * Dev only: `?devWallets=10` on any page offers that many made up wallets
 * on top of what this browser really has, so the welcome page's overflow
 * can be seen without ten extensions. They cannot connect. A no-op in
 * production, where the caller never reaches it.
 */
function withDevWallets(found: InstalledWallet<IXConnector>[]): InstalledWallet<IXConnector>[] {
  const count = Number(new URLSearchParams(window.location.search).get("devWallets"));
  if (!Number.isFinite(count) || count <= 0) return found;
  const fake = DEV_WALLETS.slice(0, Math.min(count, DEV_WALLETS.length)).map(([name, xChainType]) => {
    const connector = { id: `dev.${name.toLowerCase().replace(/ /g, "")}`, name, xChainType, isInstalled: true } as unknown as IXConnector;
    const extra = name === "Phantom" ? [{ ...connector, xChainType: "SOLANA" } as IXConnector] : [];
    return { name, connectors: [connector, ...extra], primary: connector };
  });
  return [...found, ...fake];
}
