import {
  ChainKeys,
  getSupportedSolverTokens,
  spokeChainConfig,
  type SpokeChainKey,
  type XToken,
} from "@sodax/sdk";
import { getAddress, isAddress } from "viem";

/**
 * Chains a deposit can originate from, in picker display order. Hedera is
 * supported by the protocol but its production solver token list is empty
 * today, so it can't source a fillable deposit.
 */
export const DEPOSIT_SOURCE_CHAINS: readonly SpokeChainKey[] = [
  ChainKeys.ETHEREUM_MAINNET,
  ChainKeys.ARBITRUM_MAINNET,
  ChainKeys.BASE_MAINNET,
  ChainKeys.OPTIMISM_MAINNET,
  ChainKeys.POLYGON_MAINNET,
  ChainKeys.BSC_MAINNET,
  ChainKeys.AVALANCHE_MAINNET,
  ChainKeys.SONIC_MAINNET,
  ChainKeys.SOLANA_MAINNET,
  ChainKeys.SUI_MAINNET,
  ChainKeys.BITCOIN_MAINNET,
  ChainKeys.STELLAR_MAINNET,
  ChainKeys.INJECTIVE_MAINNET,
  ChainKeys.ICON_MAINNET,
  ChainKeys.NEAR_MAINNET,
  ChainKeys.STACKS_MAINNET,
  ChainKeys.HYPEREVM_MAINNET,
  ChainKeys.LIGHTLINK_MAINNET,
  ChainKeys.KAIA_MAINNET,
  ChainKeys.REDBELLY_MAINNET,
];

export function getChainName(chainKey: SpokeChainKey): string {
  return spokeChainConfig[chainKey]?.chain.name ?? chainKey;
}

export function getChainLogo(chainKey: SpokeChainKey): string | undefined {
  return spokeChainConfig[chainKey]?.chain.logo;
}

/**
 * Tokens offered in the deposit source picker for a chain: the production
 * solver set (anything else validates locally but can never be filled),
 * minus the lsoda* vault share tokens themselves, which the registry lists
 * as solver-tradeable on Sonic but make no sense as deposit inputs.
 */
export function getDepositTokens(chainKey: SpokeChainKey): readonly XToken[] {
  return getSupportedSolverTokens(chainKey).filter(
    (token) => !token.symbol.startsWith("lsoda"),
  );
}

/**
 * The SDK registry ships some EVM addresses with broken EIP-55 casing
 * (Polygon WBTC + LINK as of @sodax/sdk 2.x). viem rejects a bad checksum
 * while ENCODING the multicall, which fails every token in the batch and
 * makes the whole chain read as zero balances. Re-checksum for balance
 * reads only — quote/deposit payloads keep the registry's original casing,
 * since the SDK and solver match tokens by exact string.
 */
export function toBalanceReadToken(token: XToken): XToken {
  if (!token.address.startsWith("0x") || isAddress(token.address))
    return token;
  return { ...token, address: getAddress(token.address.toLowerCase()) };
}
