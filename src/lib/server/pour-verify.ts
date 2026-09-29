import { Sodax, type Intent } from "@sodax/sdk";
import { sodaxConfig } from "@/lib/sodax-config";
import { listListings } from "@/lib/listings";
import { HOME_CHAIN } from "@/lib/account";

/**
 * Pour verification, hardened (replaces the old hub-tx.ts status check).
 *
 * A claimed hash must now be a genuine IntentCreated on the canonical
 * Intents contract (the SDK's getIntent parses the receipt and rejects
 * anything else — a reverted tx has no logs, so failure is covered too),
 * its intent must actually touch a tea vault in the claimed direction, and
 * when the intent's source address speaks EVM it must be the account's own
 * wallet.
 *
 * The one accepted residual: intents sourced from non-EVM chains (Solana,
 * Bitcoin, Stellar…) carry a source address we cannot compare against the
 * account's EVM rewards wallet, so those pass the ownership gate unchecked.
 * A stranger scraping fresh hub logs could claim such a hash first — once,
 * for teapot-stakes XP — and closing it needs per-family address records.
 * Recorded in thoughts.md; revisit before XP converts to anything real.
 */

let instance: Sodax | undefined;

/** Module singleton: the config is static and the SDK client is stateless. */
export function getSodax(): Sodax {
  instance ??= new Sodax(sodaxConfig);
  return instance;
}

export type PourRejection =
  | "not confirmed" // no receipt, reverted, or not an intent at all
  | "not a pour" // a real intent, but no tea vault on the claimed side
  | "not your pour"; // EVM source address that isn't the account's wallet

export type PourVerdict = { ok: true } | { ok: false; reason: PourRejection };

/** A verified pour, with what it was, for the order record (lib/server/orders). */
export type VerifiedPour =
  | { ok: true; intent: Intent; sodax: Sodax }
  | { ok: false; reason: PourRejection };

const EVM_ADDRESS = /^0x[0-9a-f]{40}$/i;

/**
 * The pure decision, separated from the RPC fetch so it can be tested
 * without a chain. `accountWallet` is the account row's stored wallet (the
 * rewards identity), not the request body's claim.
 */
export function judgePour({
  direction,
  intent,
  vaultAddresses,
  accountWallet,
  accountHubWallet,
  linkedWallets = [],
  intentAt,
}: {
  direction: "in" | "out";
  intent: Pick<Intent, "inputToken" | "outputToken" | "srcAddress">;
  /**
   * The hub wallet the account's wallet derives on the home chain. A sell
   * from the account (hubWalletSwap) is created by that hub wallet on
   * Sonic, so its intent's source address is the hub wallet, not the EOA.
   */
  accountHubWallet?: string | null;
  /** Lowercased share-token addresses of the tea vaults. */
  vaultAddresses: ReadonlySet<string>;
  accountWallet: string | null;
  /**
   * Every EVM address linked to the account (lib/server/identities
   * linkedWallets) and when it joined, epoch ms: an order paid from one is
   * the account's own only from the moment it joined, never a pour made
   * before (or while it belonged to someone else). `accountWallet`, the
   * users.wallet_address home, keeps its old rule: any time.
   */
  linkedWallets?: readonly { address: string; linkedAt: number }[];
  /** When the intent was placed (its block's time), epoch ms; needed only for a linked address. */
  intentAt?: number;
}): PourVerdict {
  const touched =
    direction === "in"
      ? intent.outputToken.toLowerCase()
      : intent.inputToken.toLowerCase();
  if (!vaultAddresses.has(touched)) {
    return { ok: false, reason: "not a pour" };
  }

  if (EVM_ADDRESS.test(intent.srcAddress)) {
    const src = intent.srcAddress.toLowerCase();
    const isHome =
      (accountWallet !== null && accountWallet.toLowerCase() === src) ||
      (!!accountHubWallet && accountHubWallet.toLowerCase() === src);
    const linked = linkedWallets.find((wallet) => wallet.address.toLowerCase() === src);
    const own = isHome || (!!linked && intentAt !== undefined && intentAt >= linked.linkedAt);
    if (!own) {
      return { ok: false, reason: "not your pour" };
    }
  }

  return { ok: true };
}

const SONIC_RPC = "https://sonic-rpc.publicnode.com";

/**
 * One cheap receipt read before the SDK gets involved: getIntent waits and
 * polls for receipts (it's built for just-submitted hashes), so an invented
 * hash would hold the route open for minutes. A single eth_getTransactionReceipt
 * answers "does this exist at all, and did it succeed" instantly.
 */
export async function receiptSucceeded(txHash: string): Promise<false | { blockNumber: string | null }> {
  try {
    const response = await fetch(SONIC_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getTransactionReceipt",
        params: [txHash],
      }),
      cache: "no-store",
    });
    if (!response.ok) return false;
    const { result } = (await response.json()) as {
      result?: { status?: string; blockNumber?: string } | null;
    };
    return result?.status === "0x1" ? { blockNumber: result.blockNumber ?? null } : false;
  } catch {
    return false;
  }
}

/** A block's timestamp, epoch ms, or undefined when the read fails (the pour then does not count). */
async function blockTime(blockNumber: string): Promise<number | undefined> {
  try {
    const response = await fetch(SONIC_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: [blockNumber, false] }),
      cache: "no-store",
    });
    if (!response.ok) return undefined;
    const { result } = (await response.json()) as { result?: { timestamp?: string } | null };
    return result?.timestamp ? Number(BigInt(result.timestamp)) * 1000 : undefined;
  } catch {
    return undefined;
  }
}

/** Full check for a claimed pour: fetch + decode the intent, then judge it. */
export async function verifyPourTx({
  txHash,
  direction,
  accountWallet,
  linkedWallets,
}: {
  txHash: string;
  direction: "in" | "out";
  accountWallet: string | null;
  linkedWallets?: readonly { address: string; linkedAt: number }[];
}): Promise<VerifiedPour> {
  const receipt = await receiptSucceeded(txHash);
  if (!receipt) {
    return { ok: false, reason: "not confirmed" };
  }

  const sodax = getSodax();
  let intent: Intent;
  try {
    // Belt on top of the receipt gate: never let the SDK's own receipt
    // polling hold a serverless route open.
    const result = await Promise.race([
      sodax.swaps.getIntent(txHash as `0x${string}`),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("getIntent timeout")), 15_000),
      ),
    ]);
    if (!result.ok) return { ok: false, reason: "not confirmed" };
    intent = result.value;
  } catch {
    return { ok: false, reason: "not confirmed" };
  }

  // Every listing counts, not only the cups: a stock or SGOV bought through
  // the house is a pour for the ledger too (lib/listings).
  const vaultAddresses = new Set(
    listListings(sodax.leverageYield.listVaults()).map((listing) =>
      listing.address.toLowerCase(),
    ),
  );
  // The block's time only matters for a pour paid from a linked address
  // that is not the home: one extra read, and only then. A sell from the
  // account is created by a hub wallet (hubWalletSwap), so its source is
  // the hub wallet of the home or of a linked address: derived only when
  // the source is none of the addresses themselves.
  const src = intent.srcAddress.toLowerCase();
  const direct =
    accountWallet?.toLowerCase() === src || (linkedWallets ?? []).some((wallet) => wallet.address.toLowerCase() === src);
  let accountHubWallet: string | null = null;
  let candidates = linkedWallets ?? [];
  if (!direct) {
    const hubOf = (address: string) =>
      sodax.hubProvider
        .getUserHubWalletAddress(address, HOME_CHAIN)
        .then((wallet) => wallet.toLowerCase())
        .catch(() => null);
    accountHubWallet = accountWallet ? await hubOf(accountWallet) : null;
    const linkedHubs = await Promise.all(
      (linkedWallets ?? []).map(async (wallet) => ({ address: (await hubOf(wallet.address)) ?? "", linkedAt: wallet.linkedAt })),
    );
    candidates = [...candidates, ...linkedHubs.filter((wallet) => wallet.address)];
  }
  const needsTime = accountWallet?.toLowerCase() !== src && accountHubWallet !== src && candidates.some((wallet) => wallet.address.toLowerCase() === src);
  const intentAt = needsTime && receipt.blockNumber ? await blockTime(receipt.blockNumber) : undefined;
  const verdict = judgePour({ direction, intent, vaultAddresses, accountWallet, accountHubWallet, linkedWallets: candidates, intentAt });
  return verdict.ok ? { ok: true, intent, sodax } : verdict;
}
