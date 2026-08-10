"use client";

import {
  useEvmSwitchChain,
  useWalletProvider,
  useXAccount,
} from "@sodax/wallet-sdk-react";
import {
  ChainKeys,
  type GetWalletProviderType,
  type SpokeChainKey,
} from "@sodax/sdk";
import { resolveAccount } from "@/lib/account";
import { useAccountSession } from "@/hooks/use-account";
import { usePrivyEvmWalletProvider } from "@/hooks/use-privy-evm-wallet";

export type VaultWalletMode = "email" | "external";

export type VaultWallet = {
  /** User address on `chainKey`, from whichever wallet source resolves. */
  address: string | undefined;
  /** Provider for dapp-kit mutations, matching `address`'s source. */
  walletProvider: GetWalletProviderType<SpokeChainKey> | undefined;
  /** Which source resolved for this chain. */
  mode: VaultWalletMode;
  /** True while an EVM external wallet sits on the wrong network. */
  isWrongChain: boolean;
  handleSwitchChain: () => void;
  /**
   * Email mode only: re-assert + verify the embedded wallet's chain on the
   * signing provider itself. MUST be awaited right before any on-chain send;
   * the embedded wallet's chain state is global and races between chain
   * switches otherwise strand the transaction on the wrong network.
   */
  ensureChain?: () => Promise<boolean>;
};

/**
 * The user's address on `chainKey` and nothing more: no signing provider, no
 * chain switch. Use this wherever a chain is only being READ about, above all
 * the withdraw destination.
 *
 * Calling useVaultWallet for a chain nobody signs on is what stranded pours
 * on the wrong network (issue #15): building the embedded bridge switches the
 * Privy wallet's chain as a side effect, that chain state is global to one
 * shared provider, and a HyperEVM cash-out therefore dragged a Polygon
 * signature onto HyperEVM, where it went out unpriced and was rejected.
 * Reading an address never needed any of that, since the embedded wallet is
 * one address across every EVM chain.
 */
export function useVaultAddress(
  chainKey: SpokeChainKey | null | undefined,
): string | undefined {
  const session = useAccountSession();
  const externalAccount = useXAccount({
    xChainId: chainKey ?? ChainKeys.SONIC_MAINNET,
  });
  return resolveAccount(
    chainKey,
    session,
    chainKey ? externalAccount.address : undefined,
  ).address;
}

/**
 * The signing face of the account module: address resolution goes through
 * the one rule in lib/account, and this hook adds the matching provider and
 * chain handling. The embedded bridge switches chains silently, so email
 * mode never reports a wrong network.
 *
 * Only for the chain the user is about to sign on. For every other chain,
 * reach for useVaultAddress above.
 */
export function useVaultWallet(
  chainKey: SpokeChainKey | null | undefined,
): VaultWallet {
  const key = chainKey ?? ChainKeys.SONIC_MAINNET;

  const session = useAccountSession();
  const privyProvider = usePrivyEvmWalletProvider(chainKey);

  const externalAccount = useXAccount({ xChainId: key });
  const externalProvider = useWalletProvider({ xChainId: key });
  const evmSwitch = useEvmSwitchChain({ xChainId: key });

  const resolved = resolveAccount(
    chainKey,
    session,
    chainKey ? externalAccount.address : undefined,
  );

  if (resolved.mode === "email") {
    return {
      address: resolved.address,
      // The bridge resolves asynchronously; consumers already handle an
      // undefined provider (CTA shows a busy state).
      walletProvider: privyProvider?.provider,
      mode: "email",
      isWrongChain: false,
      handleSwitchChain: () => {},
      ensureChain: privyProvider?.ensureChain,
    };
  }

  return {
    address: resolved.address,
    walletProvider: chainKey ? externalProvider : undefined,
    mode: "external",
    isWrongChain: evmSwitch.isWrongChain,
    handleSwitchChain: evmSwitch.handleSwitchChain,
  };
}
