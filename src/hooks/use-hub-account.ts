"use client";

import { useGetUserHubWalletAddress } from "@sodax/dapp-kit";
import type { Address } from "@sodax/sdk";
import { HOME_CHAIN, homeSpokeAddress } from "@/lib/account";
import { useAccountSession } from "@/hooks/use-account";

export type HubAccount = {
  /**
   * The spoke address the account derives from (the Privy EVM address on the
   * home chain). Undefined when nobody is signed in by email.
   */
  spokeAddress: string | undefined;
  /**
   * The account itself: the hub wallet on Sonic that every buy delivers to
   * and every sell spends from. Undefined until derived, or when signed out.
   */
  hubWallet: Address | undefined;
  /** True while the derivation is in flight. */
  isLoading: boolean;
  error: Error | null;
};

/**
 * The user's one account on the hub: the SODAX hub wallet derived from the
 * Privy embedded address on the home chain (Base). Derived through the SAME
 * SDK call the deposit builder uses for `dstAddress`
 * (`hubProvider.getUserHubWalletAddress`), so the address read here is by
 * construction the address a buy lands in. Deterministic, so dapp-kit caches
 * it and never refetches.
 *
 * `spokeAddressOverride` is for the dev page only: derive the shelf of any
 * address without signing in as them. Production callers pass nothing.
 */
export function useHubAccount(spokeAddressOverride?: string): HubAccount {
  const session = useAccountSession();
  const spokeAddress = spokeAddressOverride ?? homeSpokeAddress(session);

  const derived = useGetUserHubWalletAddress({
    params: { spokeChainId: HOME_CHAIN, spokeAddress },
  });

  return {
    spokeAddress,
    hubWallet: derived.data,
    isLoading: Boolean(spokeAddress) && derived.isLoading,
    error: derived.error,
  };
}
