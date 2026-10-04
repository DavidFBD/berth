"use client";

import { useSyncExternalStore } from "react";
import { useQueries } from "@tanstack/react-query";
import { storedWalletSession, subscribeWalletSessions, walletSessionsVersion } from "@/hooks/use-wallet-session";
import { useSodaxContext } from "@sodax/dapp-kit";
import { useAccountXAccount } from "@/hooks/use-wallet-restore";
import type { Address } from "@sodax/sdk";
import { HOME_CHAIN, homeSpokeAddress } from "@/lib/account";
import { accountHubPlan } from "@/lib/account-wallets";
import { sdkAddress } from "@/lib/chains";
import { useAccountSession } from "@/hooks/use-account";
import { useAccountWallets, usePendingWallet, useProfile } from "@/hooks/use-profile";

export type AccountHubWallet = {
  /** The EVM address the hub wallet is derived from. */
  spoke: string;
  /** Undefined until derived. */
  hubWallet: Address | undefined;
  isHome: boolean;
};

export type HubAccount = {
  /**
   * Where this session's buys land: the signing wallet when it is linked to
   * the account (so what it buys, it can sell), else the account's linked
   * home once the server has said, else the session's own address (the
   * Privy EVM address in an email session, the connected EVM wallet
   * otherwise). Undefined when neither.
   */
  spokeAddress: string | undefined;
  /**
   * The hub wallet on Sonic where this session's buys deliver
   * (`spokeAddress`'s). Undefined until derived, or when signed out.
   */
  hubWallet: Address | undefined;
  /** Every linked EVM address's hub wallet, home first: the totals add them all. */
  wallets: AccountHubWallet[];
  /** Every one of `wallets`, derived, for balance reads; empty until all are. */
  hubWallets: Address[];
  /** The address that signs on the home chain in this session. */
  signerSpoke: string | undefined;
  /** Its hub wallet: the only one a sell in this session can spend from. */
  signerHubWallet: Address | undefined;
  /**
   * Whether the signer belongs to the account. False only while an
   * extension address waits to be added (hooks/use-profile usePendingWallet):
   * an order it pays for would not count as the account's.
   */
  signerLinked: boolean;
  /** True while the home derivation is in flight. */
  isLoading: boolean;
  error: Error | null;
};

/**
 * The user's account on the hub: one SODAX hub wallet per linked EVM
 * address, derived on the home chain (Base) through the SAME SDK call the
 * deposit builder uses for `dstAddress` (`hubProvider.getUserHubWalletAddress`),
 * so the home hub wallet read here is by construction where a buy lands.
 * Deterministic, so it is cached under dapp-kit's own key and never
 * refetched. An account with one wallet reads exactly as it always did.
 *
 * `spokeAddressOverride` is for the dev page only: derive the shelf of any
 * address without signing in as them. Production callers pass nothing.
 */
export function useHubAccount(spokeAddressOverride?: string): HubAccount {
  const { sodax } = useSodaxContext();
  const session = useAccountSession();
  // The connected EVM wallet, when there is one: the store address the
  // home-chain rule falls back to outside an email session.
  const connectedEvm = useAccountXAccount({ xChainType: "EVM" });
  const sessionSpoke = homeSpokeAddress(session, connectedEvm.address);
  const pending = usePendingWallet();
  // Re-read when a wallet session is pocketed (the sign-in signature given).
  useSyncExternalStore(subscribeWalletSessions, walletSessionsVersion, () => 0);
  const linked = useAccountWallets(!spokeAddressOverride);
  const profile = useProfile();

  const plan = accountHubPlan({
    override: spokeAddressOverride,
    sessionSpoke,
    pending,
    linked: linked.data?.wallets,
    linkedLoading: linked.isLoading,
    emailSession: session.emailSession,
    walletSessionHeld: !!connectedEvm.address && !!storedWalletSession(connectedEvm.address),
    profileHome: profile.data?.homeAddress,
  });

  const spokes = [...new Set([...plan.wallets.map((wallet) => wallet.spoke), ...(plan.signer ? [plan.signer] : [])])];
  const derived = useQueries({
    queries: spokes.map((spoke) => ({
      queryKey: ["shared", "userHubWalletAddress", HOME_CHAIN, spoke],
      queryFn: () => sodax.hubProvider.getUserHubWalletAddress(sdkAddress(HOME_CHAIN, spoke), HOME_CHAIN),
      staleTime: Infinity,
      refetchInterval: false as const,
    })),
  });
  const hubOf = (spoke: string | undefined) => {
    if (!spoke) return undefined;
    const query = derived[spokes.indexOf(spoke)];
    return query?.data as Address | undefined;
  };
  const homeQuery = plan.home ? derived[spokes.indexOf(plan.home)] : undefined;

  const wallets = plan.wallets.map((wallet) => ({ ...wallet, hubWallet: hubOf(wallet.spoke) }));
  return {
    spokeAddress: plan.home,
    // Unknown home, no destination: a buy waits ("deriving") rather than
    // land in a hub wallet that may not be the home.
    hubWallet: plan.homeKnown ? hubOf(plan.home) : undefined,
    wallets,
    // All or nothing: a total that has read only some hub wallets would
    // read low, and unknown is never zero.
    hubWallets: wallets.every((wallet) => wallet.hubWallet) ? wallets.map((wallet) => wallet.hubWallet!) : [],
    signerSpoke: plan.signer,
    signerHubWallet: hubOf(plan.signer),
    signerLinked: plan.signerLinked,
    isLoading: Boolean(plan.home) && (!plan.homeKnown || (homeQuery?.isLoading ?? false)),
    error: (homeQuery?.error as Error | null | undefined) ?? null,
  };
}
