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
import {
  DEPOSIT_SOURCE_CHAINS,
  getDepositTokens,
  getNativeGasToken,
  toBalanceReadToken,
} from "@/lib/chains";
import { usePrivyEmbeddedWallet } from "@/hooks/use-privy-evm-wallet";
import { useUsdPrices } from "@/hooks/use-usd-prices";

export type EmbeddedHolding = {
  chainKey: SpokeChainKey;
  token: XToken;
  balance: bigint;
  /** Oracle USD value; undefined for tokens the money market doesn't list. */
  usdValue: number | undefined;
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
  /** True while balance sweeps or oracle prices are still in flight. */
  isLoading: boolean;
  /** What the embedded wallets hold, largest USD value first (unpriced last, in chain order). */
  holdings: EmbeddedHolding[];
  /** Chains whose balance sweep errored: their holdings are unknown, not zero. */
  erroredChains: SpokeChainKey[];
  /**
   * Chains holding tokens but ZERO native balance: any pour from there dies
   * at the network fee, so the tea is visible but stuck until gas arrives.
   */
  gasShortChains: SpokeChainKey[];
  /** Sum of the priced holdings; undefined when nothing has a price. */
  totalUsd: number | undefined;
};

/**
 * Balance sweep of the Privy embedded wallets across every chain they can
 * sign on. One disabled-when-idle query per chain via the dapp-kit query
 * builder, so results share the cache with `useXBalances` consumers.
 * Holdings are valued via the money market oracle and sorted by USD value.
 */
export function useEmbeddedHoldings(): EmbeddedHoldingsResult {
  const privy = usePrivyEmbeddedWallet();
  const solanaAccount = useXAccount({ xChainType: "SOLANA" });
  const prices = useUsdPrices();

  const emailMode =
    privy.enabled && privy.authenticated && Boolean(privy.embedded);
  const evmAddress = privy.embedded?.address;

  const swept = useQueries({
    queries: EMBEDDED_CHAINS.map((chainKey) =>
      getXBalancesQueryOptions({
        xService: getXService(getXChainType(chainKey)!),
        xChainId: chainKey,
        xTokens: getDepositTokens(chainKey).map(toBalanceReadToken),
        address: emailMode
          ? isEvmChainKeyType(chainKey)
            ? evmAddress
            : solanaAccount.address
          : undefined,
      }),
    ),
    combine: (results) => {
      const holdings: Array<Omit<EmbeddedHolding, "usdValue">> = [];
      const erroredChains: SpokeChainKey[] = [];
      const gasShortChains: SpokeChainKey[] = [];
      EMBEDDED_CHAINS.forEach((chainKey, index) => {
        const data = results[index]?.data;
        if (!data) {
          // A dead RPC must not read as an empty wallet: dapp-kit's 5s
          // refetchInterval keeps retrying, so flag the chain as unknown.
          if (results[index]?.isError) erroredChains.push(chainKey);
          return;
        }
        const nativeToken = getNativeGasToken(chainKey);
        let holdsNonNative = false;
        for (const token of getDepositTokens(chainKey)) {
          // Balances are keyed by the read token's (re-checksummed) address;
          // the holding carries the registry token so deposit params keep
          // the exact casing the SDK matches on.
          const balance = data[toBalanceReadToken(token).address] ?? 0n;
          if (balance > 0n) {
            holdings.push({ chainKey, token, balance });
            if (token.address !== nativeToken?.address) holdsNonNative = true;
          }
        }
        // Tea without a flame: tokens on this shelf but no native balance
        // (a settled record with the key missing means zero, not unknown).
        if (
          nativeToken &&
          holdsNonNative &&
          (data[toBalanceReadToken(nativeToken).address] ?? 0n) === 0n
        ) {
          gasShortChains.push(chainKey);
        }
      });
      return {
        isLoading: results.some((query) => query.isLoading),
        holdings,
        erroredChains,
        gasShortChains,
      };
    },
  });

  // Sort is stable, so unpriced holdings (sentinel -1) sink to the bottom
  // while keeping their chain order relative to each other.
  const holdings = swept.holdings
    .map((holding) => ({
      ...holding,
      usdValue: prices.usdValue(holding.token, holding.balance),
    }))
    .sort((a, b) => (b.usdValue ?? -1) - (a.usdValue ?? -1));

  const priced = holdings.filter(
    (holding) => holding.usdValue !== undefined,
  );
  const totalUsd =
    priced.length > 0
      ? priced.reduce((sum, holding) => sum + (holding.usdValue ?? 0), 0)
      : undefined;

  return {
    emailMode,
    isLoading: swept.isLoading || prices.isLoading,
    holdings,
    erroredChains: swept.erroredChains,
    gasShortChains: swept.gasShortChains,
    totalUsd,
  };
}
