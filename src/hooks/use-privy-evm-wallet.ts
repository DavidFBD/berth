"use client";

import { useEffect, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type PublicClient,
} from "viem";
import { EvmWalletProvider } from "@sodax/wallet-sdk-core";
import {
  getEvmViemChain,
  isEvmChainKeyType,
  type EvmChainKey,
  type SpokeChainKey,
} from "@sodax/sdk";
import { PRIVY_ENABLED } from "@/components/privy-provider";

/** The user's Privy embedded EVM wallet, if signed in via email. */
export function usePrivyEmbeddedWallet() {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { wallets } = useWallets();
  const embedded = wallets.find(
    (wallet) => wallet.walletClientType === "privy",
  );
  return {
    enabled: PRIVY_ENABLED,
    ready,
    authenticated,
    user,
    login,
    logout,
    embedded,
  };
}

/**
 * Bridge Privy's embedded wallet into the SODAX SDK: builds an
 * `EvmWalletProvider` (the exact type dapp-kit mutations accept) from the
 * embedded wallet's EIP-1193 provider, bound to `chainKey`'s viem chain.
 * Undefined while not signed in, not an EVM chain, or still constructing.
 */
export function usePrivyEvmWalletProvider(
  chainKey: SpokeChainKey | null | undefined,
): EvmWalletProvider | undefined {
  const { embedded } = usePrivyEmbeddedWallet();
  // Keyed by (address, chain): a stale provider from a previous key simply
  // stops being returned — no synchronous reset needed inside the effect.
  const [built, setBuilt] = useState<{
    key: string;
    provider: EvmWalletProvider;
  } | null>(null);

  const evmChainKey: EvmChainKey | undefined =
    chainKey && isEvmChainKeyType(chainKey) ? chainKey : undefined;
  const embeddedAddress = embedded?.address;
  const key =
    embeddedAddress && evmChainKey ? `${embeddedAddress}:${evmChainKey}` : null;

  useEffect(() => {
    let cancelled = false;
    if (!embedded || !embeddedAddress || !evmChainKey || !key) return;

    (async () => {
      const chain = getEvmViemChain(evmChainKey);
      // Embedded wallets switch silently (no prompt); the wallet must be on
      // the source chain before the SDK submits the intent transaction.
      await embedded.switchChain(chain.id);
      const eip1193 = await embedded.getEthereumProvider();
      if (cancelled) return;
      const walletClient = createWalletClient({
        account: embeddedAddress as `0x${string}`,
        chain,
        transport: custom(eip1193),
      });
      const publicClient = createPublicClient({
        chain,
        transport: http(),
      }) as PublicClient;
      setBuilt({
        key,
        provider: new EvmWalletProvider({ walletClient, publicClient }),
      });
    })().catch(() => {
      // Construction failed (e.g. switch rejected) — leave state as-is; the
      // key mismatch keeps the hook returning undefined for this chain.
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on address+chain, not the unstable wallet object
  }, [key]);

  return built && built.key === key ? built.provider : undefined;
}
