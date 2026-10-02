"use client";

import { useAccountXAccount } from "@/hooks/use-wallet-restore";
import { ChainKeys, type SpokeChainKey } from "@sodax/sdk";
import {
  resolveAccount,
  type AccountSession,
  type ResolvedAccount,
} from "@/lib/account";
import { usePrivyEmbeddedWallet } from "@/hooks/use-privy-evm-wallet";
import { useLinkInProgress } from "@/hooks/use-link-email";

/** The browser's session facts, as the account resolution rule needs them. */
export function useAccountSession(): AccountSession {
  const privy = usePrivyEmbeddedWallet();
  // While a wallet account adds an email, the Privy session is the flow's
  // proof, never the account: opening an email's own account to merge it
  // (hooks/use-link-email) brings its embedded wallet, which must not
  // become where this browser's money is read or sent.
  const linking = useLinkInProgress();
  return {
    emailSession:
      privy.enabled && privy.authenticated && !linking && Boolean(privy.embedded),
    embeddedEvmAddress: privy.embedded?.address,
  };
}

/**
 * The user's address on one chain, resolved through the one rule in
 * lib/account. For the signing face (provider, chain re-assert), use
 * useVaultWallet, which resolves through the same rule.
 */
export function useAccount(
  chainKey: SpokeChainKey | null | undefined,
): ResolvedAccount {
  const session = useAccountSession();
  // Hooks can't be conditional: read the store on the hub as a placeholder
  // when no chain is picked; resolveAccount(null, …) ignores it.
  const store = useAccountXAccount({
    xChainId: chainKey ?? ChainKeys.SONIC_MAINNET,
  });
  return resolveAccount(
    chainKey,
    session,
    chainKey ? store.address : undefined,
  );
}
