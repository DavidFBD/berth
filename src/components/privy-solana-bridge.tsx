"use client";

import { useEffect, useRef } from "react";
import { useStandardWallets } from "@privy-io/react-auth/solana";
import {
  sortConnectors,
  useXAccount,
  useXConnect,
  useXConnectors,
} from "@sodax/wallet-sdk-react";
import { usePrivyEmbeddedWallet } from "@/hooks/use-privy-evm-wallet";

/**
 * Inline implementation of the wallet-standard registration protocol
 * (https://github.com/wallet-standard/wallet-standard). Dependency-free on
 * purpose: the spec is stable and tiny, and the helper package isn't a
 * direct dependency of this app.
 */
function registerStandardWallet(wallet: unknown) {
  const callback = ({ register }: { register: (w: unknown) => void }) =>
    register(wallet);
  try {
    window.dispatchEvent(
      new CustomEvent("wallet-standard:register-wallet", { detail: callback }),
    );
  } catch {
    // Non-browser or locked-down environment — nothing to register into.
  }
  try {
    window.addEventListener("wallet-standard:app-ready", (event) => {
      const detail = (event as CustomEvent).detail;
      if (detail && typeof detail.register === "function") callback(detail);
    });
  } catch {
    // Ignore — late-mounting adapters just won't discover the wallet.
  }
}

/**
 * Bridges Privy's embedded Solana wallet into the SODAX wallet layer:
 * (1) registers Privy's wallet-standard implementation so SODAX's Solana
 * adapter discovers it like any installed wallet, then (2) auto-connects it
 * once for signed-in email users, making Solana source chains (JitoSOL!)
 * work in email mode with zero extra taps. Renders nothing.
 */
export function PrivySolanaBridge() {
  const privy = usePrivyEmbeddedWallet();
  const { ready, wallets } = useStandardWallets();
  const connectors = useXConnectors({ xChainType: "SOLANA" });
  const { mutateAsync: connect } = useXConnect();
  const solanaAccount = useXAccount({ xChainType: "SOLANA" });

  const registeredRef = useRef(new Set<string>());
  const connectAttemptedRef = useRef(false);

  // Step 1: registration — every Privy standard wallet, once.
  useEffect(() => {
    if (!ready) return;
    for (const wallet of wallets) {
      if (registeredRef.current.has(wallet.name)) continue;
      registeredRef.current.add(wallet.name);
      registerStandardWallet(wallet);
    }
  }, [ready, wallets]);

  // Step 2: auto-connect the discovered Privy connector for email users.
  // Only a real email session: a wallet account borrowing Privy to add an
  // email must never have a Solana wallet connected on its behalf.
  const authenticated = privy.authenticated && !privy.walletAccountSession;
  const connected = Boolean(solanaAccount.address);
  useEffect(() => {
    if (!authenticated || connected || connectAttemptedRef.current) return;
    const privyConnector = sortConnectors(connectors, {
      preferred: ["privy"],
    }).find((connector) => connector.name.toLowerCase().includes("privy"));
    if (!privyConnector) return;
    connectAttemptedRef.current = true;
    void connect(privyConnector).catch(() => {
      // Leave it manual — the connector stays available in the wallet drawer.
      connectAttemptedRef.current = false;
    });
  }, [authenticated, connected, connectors, connect]);

  // Reset the attempt guard on sign-out so a re-login reconnects.
  useEffect(() => {
    if (!authenticated) connectAttemptedRef.current = false;
  }, [authenticated]);

  return null;
}
