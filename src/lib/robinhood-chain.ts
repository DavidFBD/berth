import { ChainKeys, robinhoodChain } from "@sodax/sdk";
import { createPublicClient, erc20Abi, fallback, http, type Address, type PublicClient } from "viem";
import { getPinnedRpcUrls } from "@/lib/sodax-config";

/**
 * Robinhood Chain (chain 4663, SDK key `robinhood`) as the browser reads
 * it: where a switched account's buys are delivered as the native
 * Robinhood token, in the person's own wallet (lib/delivery,
 * docs/plans/2026-10-05-robinhood-chain-delivery P1a and P2b).
 *
 * Reads go to the pinned public RPCs (lib/sodax-config: publicnode, then
 * dRPC), each with a short timeout, and a read that does not answer is
 * unknown, never zero.
 */

/** Robinhood Chain's explorer, Blockscout, as the SDK's chain names it. */
export const ROBINHOOD_EXPLORER_URL = robinhoodChain.blockExplorers.default.url;

/** A transaction on Robinhood Chain, on Blockscout. */
export function robinhoodTxUrl(txHash: string): string {
  return `${ROBINHOOD_EXPLORER_URL}/tx/${txHash}`;
}

/** A token on Robinhood Chain, on Blockscout: the delivered stock token's own page. */
export function robinhoodTokenUrl(token: string): string {
  return `${ROBINHOOD_EXPLORER_URL}/token/${token}`;
}

/** Multicall3, deployed at its usual address on 4663 (eth_getCode read 2026-10-05); the SDK's chain does not name it. */
const MULTICALL3: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";

/** Per endpoint: a slow RPC gives way to the next one rather than hold the screen. */
const RPC_TIMEOUT_MS = 6_000;

let client: PublicClient | undefined;

/** One viem client for Robinhood Chain, built on first use only, so an account that never reads the chain never builds it. */
export function robinhoodClient(): PublicClient {
  if (client) return client;
  const urls = getPinnedRpcUrls(ChainKeys.ROBINHOOD_MAINNET);
  client = createPublicClient({
    chain: { ...robinhoodChain, contracts: { multicall3: { address: MULTICALL3 } } },
    transport: fallback(
      urls.map((url) => http(url, { timeout: RPC_TIMEOUT_MS, retryCount: 0 })),
      { retryCount: 0 },
    ),
  }) as PublicClient;
  return client;
}

/** The token addresses a read covers: every listing that has a Robinhood Chain token, in the order given. */
export type RobinhoodToken = { rhAddress: Address };

/**
 * `balanceOf(owner)` of each token for each owner, in one multicall,
 * summed over the owners: one total per token, in the order given. Throws
 * when the chain does not answer (the caller decides what unknown means).
 */
export async function readRobinhoodBalances(
  read: Pick<PublicClient, "multicall">,
  tokens: readonly RobinhoodToken[],
  owners: readonly Address[],
): Promise<bigint[]> {
  const byOwner = await readRobinhoodBalancesByOwner(read, tokens, owners);
  return tokens.map((_, index) => byOwner.reduce((sum, balances) => sum + (balances[index] ?? 0n), 0n));
}

/**
 * The same read, kept per owner: for each owner, in the order given, its
 * balance of each token, in the order given. A sell from Robinhood Chain
 * spends one wallet's tokens, so it needs each wallet's own figure, never
 * the sum. Throws when the chain does not answer.
 */
export async function readRobinhoodBalancesByOwner(
  read: Pick<PublicClient, "multicall">,
  tokens: readonly RobinhoodToken[],
  owners: readonly Address[],
): Promise<bigint[][]> {
  if (owners.length === 0) return [];
  if (tokens.length === 0) return owners.map(() => []);
  const results = await read.multicall({
    allowFailure: false,
    contracts: owners.flatMap((owner) =>
      tokens.map((token) => ({
        address: token.rhAddress,
        abi: erc20Abi,
        functionName: "balanceOf" as const,
        args: [owner] as const,
      })),
    ),
  });
  const flat = results.map((value) => BigInt(value as bigint));
  return owners.map((_, ownerIndex) => tokens.map((_, index) => flat[ownerIndex * tokens.length + index] ?? 0n));
}
