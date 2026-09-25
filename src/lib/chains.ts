import {
  ChainKeys,
  getSupportedSolverTokens,
  spokeChainConfig,
  type SpokeChainKey,
  type XToken,
} from "@sodax/sdk";
import { getAddress, isAddress } from "viem";
import { sonic } from "viem/chains";
import { isTokenListingAddress } from "@/lib/listings";

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
 * minus everything the house itself offers as a destination: the lsoda*
 * vault share tokens, and the stock and cash listings. The SDK lists the
 * shares as solver-tradeable on Sonic, and a future release will list the
 * stocks too; neither makes sense as something to pour IN, since selling a
 * listing is the sell path's job, not the deposit picker's.
 */
export function getDepositTokens(chainKey: SpokeChainKey): readonly XToken[] {
  return getSupportedSolverTokens(chainKey).filter(
    (token) =>
      !token.symbol.startsWith("lsoda") &&
      !isTokenListingAddress(token.address),
  );
}

/**
 * The chain's native (gas) token as an XToken, when the solver list carries
 * it. A pour FROM a chain is an on-chain transaction there, so the sending
 * wallet needs a non-zero native balance to cover the network fee.
 */
export function getNativeGasToken(chainKey: SpokeChainKey): XToken | undefined {
  const nativeAddress = spokeChainConfig[chainKey]?.nativeToken;
  if (!nativeAddress) return undefined;
  return getDepositTokens(chainKey).find(
    (token) => token.address === nativeAddress,
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

/** A transaction on the Sonic hub, on the explorer viem knows for Sonic. */
export function hubTxUrl(txHash: string): string {
  return `${sonic.blockExplorers.default.url}/tx/${txHash}`;
}
