import {
  ChainKeys,
  getSupportedSolverTokens,
  isBitcoinChainKeyType,
  isEvmChainKeyType,
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

/**
 * Names people know where the SDK's own differs: it calls HyperEVM "Hyper",
 * which reads as a typo in "a little HYPE on Hyper". Display only; nothing
 * keys on a chain's display name.
 */
const CHAIN_NAME_OVERRIDES: Partial<Record<SpokeChainKey, string>> = {
  [ChainKeys.HYPEREVM_MAINNET]: "HyperEVM",
};

export function getChainName(chainKey: SpokeChainKey): string {
  return CHAIN_NAME_OVERRIDES[chainKey] ?? spokeChainConfig[chainKey]?.chain.name ?? chainKey;
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
 *
 * Bitcoin has none in this sense: the fee comes out of the BTC being sent
 * (lib/gas-need calls it `free`), so there is no separate balance to gate
 * on. Up to @sodax/sdk 2.0.0 that held by accident, since Bitcoin's
 * nativeToken was 'BTC' and matched no solver token; from 2.2 it is '0:0',
 * BTC's own address, so it is said here on purpose.
 */
export function getNativeGasToken(chainKey: SpokeChainKey): XToken | undefined {
  if (isBitcoinChainKeyType(chainKey)) return undefined;
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
 *
 * EVM-only: every other chain family has its own address shape (a Sui coin
 * type like `0x2::sui::SUI` also starts with `0x`, a Stacks token pairs a
 * `SP…` principal with a contract and asset name, …) and none of it is a
 * viem address, so `isAddress`/`getAddress` must never see it. Route on the
 * token's own chain, not on how its address happens to look.
 */
export function toBalanceReadToken(token: XToken): XToken {
  if (!isEvmChainKeyType(token.chainKey)) return token;
  if (!token.address.startsWith("0x") || isAddress(token.address))
    return token;
  return { ...token, address: getAddress(token.address.toLowerCase()) };
}

/** A transaction on the Sonic hub, on the explorer viem knows for Sonic. */
export function hubTxUrl(txHash: string): string {
  return `${sonic.blockExplorers.default.url}/tx/${txHash}`;
}

/**
 * A transaction on a source chain, where the order machine has a reason to
 * point someone at it: today only Bitcoin, whose payment can take an hour to
 * reach Sonic and is followed on mempool.space meanwhile.
 */
export function spokeTxUrl(
  chainKey: SpokeChainKey,
  txHash: string,
): string | undefined {
  return isBitcoinChainKeyType(chainKey)
    ? `https://mempool.space/tx/${txHash}`
    : undefined;
}
