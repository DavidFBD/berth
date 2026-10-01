/**
 * The read only check behind "Mark paid": is this transaction hash, on
 * Base, a successful USDC transfer of exactly the claim's amount to the
 * claim's payout address? Read from a public RPC (eth_getTransactionReceipt),
 * nothing signed, nothing sent. The pure half (`judgeUsdcReceipt`) decides
 * from a receipt; the IO half fetches it and is injected in tests.
 *
 * Only transfers from the house's payout wallets (STAFF_PAYOUT_ADDRESSES)
 * count. A receipt that pays the address less than its claims need, or a
 * reverted one, is a refusal; one that cannot be read (not mined yet, on
 * another chain, the RPC down) leaves the hash pending on an approved
 * claim, never paid.
 */

export const PAYOUT_CHAIN = { key: "base", name: "Base", chainId: 8453, rpcUrl: "https://mainnet.base.org" } as const;

/** Circle's native USDC on Base. */
export const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
export const USDC_DECIMALS = 6;

/** keccak256("Transfer(address,address,uint256)") */
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export const TX_HASH_SHAPE = /^0x[0-9a-f]{64}$/;

export type ReceiptLog = { address?: string; topics?: string[]; data?: string };
export type Receipt = { status?: string; logs?: ReceiptLog[]; blockNumber?: string } | null;

/** A USD amount in USDC's raw units: 5 -> 5000000. Cents only. */
export function usdcRaw(amountUsd: number): bigint {
  return BigInt(Math.round(amountUsd * 100)) * 10n ** BigInt(USDC_DECIMALS - 2);
}

function topicAddress(topic: string | undefined): string | null {
  if (!topic || !/^0x[0-9a-fA-F]{64}$/.test(topic)) return null;
  return `0x${topic.slice(26).toLowerCase()}`;
}

/**
 * The global fallback payout wallets (STAFF_PAYOUT_ADDRESSES, comma
 * separated EVM addresses, optional): they count for every campaign,
 * beside each campaign's own payout sources (campaign_payout_sources,
 * managed on /staff/campaigns). A transfer counts only from one of them,
 * so a pasted hash of anybody else's USDC to the same address never reads
 * as paid.
 */
export function payoutSenders(env: Record<string, string | undefined> = process.env): Set<string> {
  return new Set(
    (env.STAFF_PAYOUT_ADDRESSES ?? "")
      .split(",")
      .map((address) => address.trim().toLowerCase())
      .filter((address) => /^0x[0-9a-f]{40}$/.test(address)),
  );
}

/** What one transaction did in USDC on Base, from the house's payout wallets, by recipient. */
export type UsdcTransfers =
  | { outcome: "read"; block: string | null; byRecipient: Record<string, string>; others: { from: string; to: string; raw: string }[] }
  | { outcome: "tx_failed" }
  | { outcome: "not_found" }
  | { outcome: "unreachable"; error: string };

export function readUsdcTransfers(receipt: Receipt, senders: ReadonlySet<string>): UsdcTransfers {
  if (!receipt) return { outcome: "not_found" };
  if (receipt.status !== "0x1") return { outcome: "tx_failed" };
  const sums = new Map<string, bigint>();
  const others: { from: string; to: string; raw: string }[] = [];
  for (const log of receipt.logs ?? []) {
    if ((log.address ?? "").toLowerCase() !== USDC_BASE) continue;
    if ((log.topics?.[0] ?? "").toLowerCase() !== TRANSFER_TOPIC) continue;
    const from = topicAddress(log.topics?.[1]);
    const to = topicAddress(log.topics?.[2]);
    if (!from || !to) continue;
    let raw: bigint;
    try {
      raw = BigInt(log.data && log.data !== "0x" ? log.data : "0x0");
    } catch {
      continue;
    }
    if (senders.has(from)) sums.set(to, (sums.get(to) ?? 0n) + raw);
    else others.push({ from, to, raw: raw.toString() });
  }
  return {
    outcome: "read",
    block: receipt.blockNumber ?? null,
    byRecipient: Object.fromEntries([...sums].map(([to, raw]) => [to, raw.toString()])),
    others,
  };
}

/**
 * Whether the transfers pay `to` what every claim this transaction is
 * recorded against at that address needs (`requiredRaw`): a batch payout
 * may pay several claims, each recipient its own sum. Pure.
 */
export function paysEnough(transfers: Extract<UsdcTransfers, { outcome: "read" }>, to: string, requiredRaw: bigint): boolean {
  return BigInt(transfers.byRecipient[to.toLowerCase()] ?? "0") >= requiredRaw && requiredRaw > 0n;
}

export type ReceiptFetcher = (txHash: string) => Promise<Receipt>;

/** eth_getTransactionReceipt on Base's public RPC; throws when it does not answer. */
export const fetchBaseReceipt: ReceiptFetcher = async (txHash) => {
  const response = await fetch(PAYOUT_CHAIN.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [txHash] }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`rpc http ${response.status}`);
  const body = (await response.json()) as { result?: Receipt; error?: { message?: string } };
  if (body.error) throw new Error(`rpc ${body.error.message ?? "error"}`);
  return body.result ?? null;
};

export async function fetchUsdcTransfers(
  txHash: string,
  senders: ReadonlySet<string>,
  fetchReceipt: ReceiptFetcher = fetchBaseReceipt,
): Promise<UsdcTransfers> {
  let receipt: Receipt;
  try {
    receipt = await fetchReceipt(txHash);
  } catch (error) {
    return { outcome: "unreachable", error: error instanceof Error ? error.message.slice(0, 120) : "error" };
  }
  return readUsdcTransfers(receipt, senders);
}
