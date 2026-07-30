"use client";

import type { ReactNode } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";

const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

/** Required for the /solana hooks — without this slot they crash on a null config. */
const solanaConnectors = toSolanaWalletConnectors({ shouldAutoConnect: false });

/** Whether email login is available (Privy app id configured). */
export const PRIVY_ENABLED = Boolean(appId);

/**
 * Mounts Privy for email login + embedded EVM wallets. Renders children
 * untouched when no app id is configured, so the app degrades gracefully to
 * external-wallet-only mode.
 */
export function AppPrivyProvider({ children }: { children: ReactNode }) {
  if (!appId) return <>{children}</>;

  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["email"],
        embeddedWallets: {
          ethereum: { createOnLogin: "users-without-wallets" },
          solana: { createOnLogin: "users-without-wallets" },
        },
        externalWallets: {
          solana: { connectors: solanaConnectors },
        },
        appearance: {
          walletList: [],
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
