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
import { resolveAccount } from "@/lib/account";
import { useAccountSession } from "@/hooks/use-account";
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

/**
 * How often to re-sweep the wallets. dapp-kit's query builder hardcodes a 5s
 * refetch, which is far too hot for a whole-wallet sweep: the SDK's Solana
 * service exposes only a single-token `getBalance`, so the base class fans a
 * sweep out to ONE RPC call PER TOKEN — 21 calls every 5 seconds on Solana
 * alone. Keyless public endpoints answer that with 429s, web3.js retries with
 * backoff, and the read then fails closed (`getBalance` swallows errors and
 * returns 0), so a rate-limited wallet reads as an EMPTY one.
 *
 * This is a holdings overview, not a live ticker — a minute is plenty. The
 * amount a pour is actually validated against stays on the fast path, read
 * per-token in the drawer.
 */
const SWEEP_INTERVAL_MS = 60_000;

/** Below this, a priced holding is unusable residue and is neither shown nor
 * counted anywhere (list, teapot worth, table total). */
const DUST_USD = 0.1;

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
  const session = useAccountSession();
  const solanaAccount = useXAccount({ xChainType: "SOLANA" });
  const prices = useUsdPrices();

  const emailMode = session.emailSession;

  const swept = useQueries({
    queries: EMBEDDED_CHAINS.map((chainKey) => ({
      ...getXBalancesQueryOptions({
        xService: getXService(getXChainType(chainKey)!),
        xChainId: chainKey,
        xTokens: getDepositTokens(chainKey).map(toBalanceReadToken),
        // The store address passed here is the Solana account: EVM rows
        // resolve to the embedded address and never read it, and
        // EMBEDDED_CHAINS contains nothing but EVM + Solana.
        address: emailMode
          ? resolveAccount(chainKey, session, solanaAccount.address).address
          : undefined,
      }),
      // Must come AFTER the spread — see SWEEP_INTERVAL_MS.
      refetchInterval: SWEEP_INTERVAL_MS,
      staleTime: SWEEP_INTERVAL_MS,
    })),
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
  // while keeping their chain order relative to each other. Priced holdings
  // below the dust line vanish entirely (David's call): a residue too small
  // to cover its own pour is not a holding, it's noise — showing €0.03 of
  // BNB just invites a doomed pour attempt. Top the token up and it crosses
  // the line and reappears. Unpriced holdings stay: unknown is not dust.
  const holdings = swept.holdings
    .map((holding) => ({
      ...holding,
      usdValue: prices.usdValue(holding.token, holding.balance),
    }))
    .filter(
      (holding) =>
        holding.usdValue === undefined || holding.usdValue >= DUST_USD,
    )
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
