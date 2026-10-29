import { ChainKeys, type SpokeChainKey, type XToken } from "@sodax/sdk";
import { getDepositTokens } from "@/lib/chains";

/** USDC on Base, the place a sell or a take out arrives unless the person says otherwise. */
export const DEFAULT_SELL_USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

/**
 * Where a sell or a take out from Cash goes before the person has chosen:
 * USDC on Base, into their own wallet on Base. The token is the SDK's own
 * entry for Base (matched by address, so its symbol and decimals are the
 * SDK's, never a hand-built object); null when the SDK does not list it,
 * and the sheet then asks where to, as it always did. Pure.
 */
export function defaultSellDestination(
  tokens: readonly XToken[] = getDepositTokens(ChainKeys.BASE_MAINNET as SpokeChainKey),
): { chainKey: SpokeChainKey; token: XToken } | null {
  const token = tokens.find((candidate) => candidate.address.toLowerCase() === DEFAULT_SELL_USDC_BASE.toLowerCase());
  return token ? { chainKey: ChainKeys.BASE_MAINNET as SpokeChainKey, token } : null;
}
