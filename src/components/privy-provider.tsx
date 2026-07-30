"use client";

import type { ReactNode } from "react";
import { PrivyProvider } from "@privy-io/react-auth";

const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

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
