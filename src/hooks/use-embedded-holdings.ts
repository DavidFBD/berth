"use client";

import { useQueries } from "@tanstack/react-query";
import { getXBalancesQueryOptions } from "@sodax/dapp-kit";
import {
  getXChainType,
  getXService,
  useXAccount,
} from "@sodax/wallet-sdk-react";
import {
  ChainKeys,
  isEvmChainKeyType,
  type SpokeChainKey,
  type XToken,
} from "@sodax/sdk";
import { DEPOSIT_SOURCE_CHAINS, getDepositTokens } from "@/lib/chains";
import { usePrivyEmbeddedWallet } from "@/hooks/use-privy-evm-wallet";

export type EmbeddedHolding = {
  chainKey: SpokeChainKey;
  token: XToken;
  balance: bigint;
};

/**
 * Chains a Privy email account can actually sign on: one embedded address
 * covers every EVM chain, and the embedded Solana wallet is bridged into the
 * SODAX wallet store. Everything else (Bitcoin, Sui, Stellar…) needs an
 * external wallet and stays out of the email-mode flow.
 */
export const EMBEDDED_CHAINS: readonly SpokeChainKey[] =
  DEPOSIT_SOURCE_CHAINS.filter(
    (key) => isEvmChainKeyType(key) || key === ChainKeys.SOLANA_MAINNET,
  );

export type EmbeddedHoldingsResult = {
  /** True when the user is signed in via email with an embedded wallet. */
  emailMode: boolean;
  /** True while any per-chain balance sweep is still in flight. */
  isLoading: boolean;
  /** Every deposit-eligible token the embedded wallets hold, in chain order. */
  holdings: EmbeddedHolding[];
};

/**
 * Balance sweep of the Privy embedded wallets across every chain they can
 * sign on. One disabled-when-idle query per chain via the dapp-kit query
 * builder, so results share the cache with `useXBalances` consumers.
 */
export function useEmbeddedHoldings(): EmbeddedHoldingsResult {
  const privy = usePrivyEmbeddedWallet();
  const solanaAccount = useXAccount({ xChainType: "SOLANA" });

  const emailMode =
    privy.enabled && privy.authenticated && Boolean(privy.embedded);
  const evmAddress = privy.embedded?.address;

  return useQueries({
    queries: EMBEDDED_CHAINS.map((chainKey) =>
      getXBalancesQueryOptions({
        xService: getXService(getXChainType(chainKey)!),
        xChainId: chainKey,
        xTokens: getDepositTokens(chainKey),
        address: emailMode
          ? isEvmChainKeyType(chainKey)
            ? evmAddress
            : solanaAccount.address
          : undefined,
      }),
    ),
    combine: (results) => {
      const holdings: EmbeddedHolding[] = [];
      EMBEDDED_CHAINS.forEach((chainKey, index) => {
        const data = results[index]?.data;
        if (!data) return;
        for (const token of getDepositTokens(chainKey)) {
          const balance = data[token.address] ?? 0n;
          if (balance > 0n) holdings.push({ chainKey, token, balance });
        }
      });
      return {
        emailMode,
        isLoading: results.some((query) => query.isLoading),
        holdings,
      };
    },
  });
}
