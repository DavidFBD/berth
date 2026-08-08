import { addRpcUrlOverrideToChain } from "@privy-io/react-auth";
import { ChainKeys, getEvmViemChain, isEvmChainKeyType } from "@sodax/sdk";
import type { Chain } from "viem";
import { getPinnedRpcUrl } from "@/lib/sodax-config";

/**
 * Chain registry handed to Privy. Without an explicit list, Privy resolves
 * chain ids against its bundled viem registry, which still carries dead
 * testnets on reused ids: HyperEVM mainnet shares id 999 with Zora Goerli,
 * so a HyperEVM pour showed a testnet approval modal and signed through
 * Zora's decommissioned RPC (issue #13). Deriving the list from the SDK
 * keeps Privy's view of the EVM spoke chains identical to the SDK's, and
 * the pinned publicnode endpoints override registry defaults that are known
 * to die (polygon-rpc.com).
 */
export const PRIVY_SUPPORTED_CHAINS: Chain[] = Object.values(ChainKeys)
  .filter(isEvmChainKeyType)
  .map((chainKey) => {
    const chain = getEvmViemChain(chainKey);
    const pinned = getPinnedRpcUrl(chainKey);
    return pinned ? addRpcUrlOverrideToChain(chain, pinned) : chain;
  });

/**
 * Where the embedded wallet parks between pours: the hub, where the vault
 * shares live. Every send re-asserts its own chain anyway (ensureChain), so
 * this only pins the idle state to something deterministic.
 */
export const PRIVY_DEFAULT_CHAIN: Chain =
  PRIVY_SUPPORTED_CHAINS.find(
    (chain) => chain.id === getEvmViemChain(ChainKeys.SONIC_MAINNET).id,
  ) ?? PRIVY_SUPPORTED_CHAINS[0];
