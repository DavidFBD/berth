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
import { getPinnedRpcUrl } from "@/lib/sodax-config";

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

type Eip1193 = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

export type PrivyEvmWallet = {
  provider: EvmWalletProvider;
  /**
   * Re-assert the chain on the SAME provider instance the walletClient
   * signs through, verifying eth_chainId before reporting true. Privy's
   * embedded wallet is one shared provider with global chain state, and
   * concurrent switchChain calls (drawer default chain vs the auto-selected
   * holding) resolve in arbitrary order — whichever lands last wins. Without
   * this, the tx targets chain X while the wallet sits on chain Y and viem
   * rejects with a chain mismatch. Call it right before every send.
   */
  ensureChain: () => Promise<boolean>;
};

/**
 * Bridge Privy's embedded wallet into the SODAX SDK: builds an
 * `EvmWalletProvider` (the exact type dapp-kit mutations accept) from the
 * embedded wallet's EIP-1193 provider, bound to `chainKey`'s viem chain.
 * Undefined while not signed in, not an EVM chain, or still constructing.
 */
export function usePrivyEvmWalletProvider(
  chainKey: SpokeChainKey | null | undefined,
): PrivyEvmWallet | undefined {
  const { embedded } = usePrivyEmbeddedWallet();
  // Keyed by (address, chain): a stale provider from a previous key simply
  // stops being returned — no synchronous reset needed inside the effect.
  const [built, setBuilt] = useState<{
    key: string;
    wallet: PrivyEvmWallet;
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
      const eip1193 = (await embedded.getEthereumProvider()) as Eip1193;
      if (cancelled) return;

      const ensureChain = async (): Promise<boolean> => {
        const hexId = `0x${chain.id.toString(16)}`;
        try {
          await eip1193.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: hexId }],
          });
          // Verify: the switch can lag while a competing switch settles.
          for (let attempt = 0; attempt < 10; attempt++) {
            const current = (await eip1193.request({
              method: "eth_chainId",
            })) as string;
            if (Number.parseInt(current, 16) === chain.id) return true;
            await new Promise((resolve) => setTimeout(resolve, 300));
          }
        } catch {
          // Fall through — a false return keeps the pour from being sent
          // onto the wrong chain.
        }
        return false;
      };

      const walletClient = createWalletClient({
        account: embeddedAddress as `0x${string}`,
        chain,
        transport: custom(eip1193),
      });
      // Explicit RPC: the SDK's viem defaults include dead endpoints
      // (polygon-rpc.com 401s), and this client does the gas estimation and
      // receipt polling for the pour itself.
      const publicClient = createPublicClient({
        chain,
        transport: http(getPinnedRpcUrl(evmChainKey)),
      }) as PublicClient;
      setBuilt({
        key,
        wallet: {
          provider: new EvmWalletProvider({ walletClient, publicClient }),
          ensureChain,
        },
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

  return built && built.key === key ? built.wallet : undefined;
}
