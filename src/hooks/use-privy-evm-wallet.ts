"use client";

import { useEffect, useRef, useState } from "react";
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
  const { ready, authenticated, user, login, logout, getAccessToken } =
    usePrivy();
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
    /**
     * Resolves the current Privy access token, refreshing a stale one. The
     * embedded wallet throws 4900 without it, so every send asks first.
     */
    getAccessToken,
  };
}

type Eip1193 = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

/**
 * Whether a pour can be sent right now, and when it can't, which precondition
 * failed. Two reasons, because they need different words: a stolen chain is
 * worth retrying on the spot, a lapsed session needs a fresh sign-in first.
 */
export type PourReadiness = "ready" | "wrong-chain" | "session-expired";

export type PrivyEvmWallet = {
  provider: EvmWalletProvider;
  /**
   * The send precondition, on the SAME provider instance the walletClient
   * signs through. Two checks, in order.
   *
   * The Privy access token first: the embedded wallet throws EIP-1193 4900
   * ("Disconnected") out of eth_sendTransaction when the token is missing,
   * which viem then reports as "The Provider is disconnected from all
   * chains" — prose about chains for a condition that has nothing to do with
   * them (issue #21).
   *
   * Then the chain, verified by eth_chainId rather than assumed. Privy's
   * embedded wallet is one shared provider with global chain state, and
   * concurrent switchChain calls (drawer default chain vs the auto-selected
   * holding) resolve in arbitrary order — whichever lands last wins. Without
   * this the tx targets chain X while the wallet sits on chain Y.
   *
   * Call it right before every send.
   */
  ensureReady: () => Promise<PourReadiness>;
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
  const { embedded, getAccessToken } = usePrivyEmbeddedWallet();
  // Held in a ref so the closure built once per (address, chain) always calls
  // the live function rather than the one captured at construction. Synced in
  // an effect, not during render: the ref is only ever read from inside
  // ensureReady, which runs on a tap, long after mount.
  const getAccessTokenRef = useRef(getAccessToken);
  useEffect(() => {
    getAccessTokenRef.current = getAccessToken;
  }, [getAccessToken]);
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

      const ensureReady = async (): Promise<PourReadiness> => {
        // The token before the chain. This pipeline hands a token plenty of
        // time to lapse: build, allowance retries, a wallet prompt, then the
        // ~15s the SDK spends simulating. getAccessToken refreshes a stale
        // one, so asking here both prevents the ordinary failure and names
        // the rare one instead of letting viem call a live session a chain
        // problem (issue #21, field-found 2026-09-01).
        try {
          if (!(await getAccessTokenRef.current())) {
            console.error(
              "[privy-wallet] no Privy access token at send time — the session has lapsed, and the wallet would throw 4900",
            );
            return "session-expired";
          }
        } catch (error) {
          console.error(
            "[privy-wallet] Privy access token refresh threw — treating the session as lapsed",
            error,
          );
          return "session-expired";
        }

        const hexId = `0x${chain.id.toString(16)}`;
        // Either failure path must leave a console trail: this is the one
        // abort the drawers surface with no raw error attached, so field
        // reports are undiagnosable without it.
        let lastSeen: string | undefined;
        try {
          await eip1193.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: hexId }],
          });
          // Verify: the switch can lag while a competing switch settles.
          for (let attempt = 0; attempt < 20; attempt++) {
            lastSeen = (await eip1193.request({
              method: "eth_chainId",
            })) as string;
            if (Number.parseInt(lastSeen, 16) === chain.id) return "ready";
            await new Promise((resolve) => setTimeout(resolve, 300));
          }
          console.error(
            `[privy-wallet] chain re-assert timed out: wanted ${hexId} (${evmChainKey}), wallet still reports ${lastSeen} — a competing switch kept winning`,
          );
        } catch (error) {
          console.error(
            `[privy-wallet] chain switch to ${hexId} (${evmChainKey}) threw — stale Privy iframe or unreachable Privy API`,
            error,
          );
        }
        // Anything but "ready" keeps the pour off the wrong chain.
        return "wrong-chain";
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
          ensureReady,
        },
      });
    })().catch((error) => {
      // Construction failed (e.g. switch rejected) — leave state as-is; the
      // key mismatch keeps the hook returning undefined for this chain, and
      // the consumer's CTA sits in a busy state with no visible error.
      console.error(
        `[privy-wallet] provider construction for ${evmChainKey} failed`,
        error,
      );
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on address+chain, not the unstable wallet object
  }, [key]);

  return built && built.key === key ? built.wallet : undefined;
}
