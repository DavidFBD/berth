"use client";

import {
  useEvmSwitchChain,
  useWalletProvider,
  useXAccount,
} from "@sodax/wallet-sdk-react";
import {
  ChainKeys,
  isEvmChainKeyType,
  type GetWalletProviderType,
  type SpokeChainKey,
} from "@sodax/sdk";
import {
  usePrivyEmbeddedWallet,
  usePrivyEvmWalletProvider,
} from "@/hooks/use-privy-evm-wallet";

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
 * Per-chain wallet resolution with Privy preferred on EVM: a user signed in
 * via email gets their embedded wallet for any EVM source chain; every other
 * case (non-EVM chains, no Privy session) falls back to the SODAX wallet
 * store (external wallets). The embedded bridge switches chains silently, so
 * email mode never reports a wrong network.
 */
export function useVaultWallet(
  chainKey: SpokeChainKey | null | undefined,
): VaultWallet {
  const key = chainKey ?? ChainKeys.SONIC_MAINNET;

  const privy = usePrivyEmbeddedWallet();
  const privyProvider = usePrivyEvmWalletProvider(chainKey);

  const externalAccount = useXAccount({ xChainId: key });
  const externalProvider = useWalletProvider({ xChainId: key });
  const evmSwitch = useEvmSwitchChain({ xChainId: key });

  const emailMode =
    privy.enabled &&
    privy.authenticated &&
    Boolean(privy.embedded) &&
    Boolean(chainKey) &&
    isEvmChainKeyType(key);

  if (emailMode) {
    return {
      address: privy.embedded?.address,
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
    address: chainKey ? externalAccount.address : undefined,
    walletProvider: chainKey ? externalProvider : undefined,
    mode: "external",
    isWrongChain: evmSwitch.isWrongChain,
    handleSwitchChain: evmSwitch.handleSwitchChain,
  };
}
