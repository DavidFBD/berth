import { parseUnits } from "viem";

/**
 * Whether a campaign buy was kept for the whole hold, not only at one
 * moment. A single balance read at a known hour can be met by selling
 * at once and moving the stake back in before the check (one stake can
 * then serve many accounts in turn). So the check reads the listing
 * token's Transfer logs into and out of the delivery wallet from the
 * buy's own block to now, on Sonic, read only, and walks the balance back
 * from today's: the lowest it stood between the buy and the end of the
 * hold must still cover the buy's quantity.
 *
 * Shape: the pure walk (`lowestBalance`) and the IO (`readHoldWindow`,
 * plain JSON-RPC against Sonic's public endpoint, chunked to its log
 * range). Anything that cannot be read is "unknown": no verdict, tried
 * again the next morning. Nothing is ever judged on doubt.
 */

export const SONIC_LOGS_RPC = "https://rpc.soniclabs.com";
/** The widest eth_getLogs range the endpoint answers (measured 2026-10-01: 500k works). */
export const LOG_CHUNK_BLOCKS = 400_000n;
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const LISTING_DECIMALS = 18;
/**
 * Blocks behind the head the window ends at. Logs and the balance are read
 * at the same block, this far back, so a node of a load balanced RPC that
 * has not seen the newest blocks cannot hand over a balance that includes
 * a transfer its logs leave out.
 */
export const CONFIRMATIONS = 64n;

export type TransferEvent = {
  block: bigint;
  logIndex: number;
  from: string;
  to: string;
  value: bigint;
  /** The block's time, epoch ms. */
  at: number;
};

export type HoldQuery = {
  /** The delivery wallet (a hub wallet on Sonic). */
  holder: string;
  listing: string;
  /** The buy's fill transaction on Sonic (else its intent): the window starts at its block. */
  startTx: string;
  /** Decimal units the buy delivered. */
  quantity: string;
  /** The end of the hold: balances after this moment do not count. */
  until: Date;
};

export type HoldReading =
  | { verdict: "held" | "not_held"; balanceRaw: string; lowestRaw: string; outflows: number; fromBlock: string; toBlock: string }
  | { verdict: "unknown"; error: string };

export type HoldVerifier = (query: HoldQuery) => Promise<HoldReading>;

/**
 * The lowest balance the holder had at any moment from just after the
 * window's first event (the buy's own delivery) to `untilMs`, walking
 * back from `balanceNow` (read at the window's last block). Events are
 * every Transfer of the token into or out of the holder in the window.
 */
export function lowestBalance(
  balanceNow: bigint,
  events: readonly TransferEvent[],
  holder: string,
  untilMs: number,
  /** The buy's own delivery log: anything before it, even in its own block, is before the buy. */
  start?: { block: bigint; logIndex: number },
): bigint {
  const who = holder.toLowerCase();
  const sorted = [...events].sort((a, b) => (a.block === b.block ? a.logIndex - b.logIndex : a.block < b.block ? -1 : 1));
  const counts = (event: TransferEvent) =>
    event.at <= untilMs && (!start || event.block > start.block || (event.block === start.block && event.logIndex >= start.logIndex));
  // The balance after each event, from the last back to the first.
  let balance = balanceNow;
  let lowest: bigint | null = sorted.length === 0 || counts(sorted[sorted.length - 1]) ? balanceNow : null;
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const event = sorted[index];
    // `balance` is the balance just after `event`.
    if (counts(event) && (lowest === null || balance < lowest)) lowest = balance;
    if (event.to.toLowerCase() === who) balance -= event.value;
    if (event.from.toLowerCase() === who) balance += event.value;
  }
  return lowest ?? balance;
}

/** The verdict from a walk: the lowest balance covers the buy. */
export function judgeWindow(quantity: string, lowest: bigint): "held" | "not_held" | "unknown" {
  let needed: bigint;
  try {
    needed = parseUnits(quantity, LISTING_DECIMALS);
  } catch {
    return "unknown";
  }
  if (needed <= 0n) return "unknown";
  return lowest >= needed ? "held" : "not_held";
}

type Rpc = (method: string, params: unknown[]) => Promise<unknown>;

export function jsonRpc(url: string, fetcher: typeof fetch = fetch): Rpc {
  return async (method, params) => {
    const response = await fetcher(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`rpc http ${response.status}`);
    const body = (await response.json()) as { result?: unknown; error?: { message?: string } };
    if (body.error) throw new Error(`rpc ${body.error.message ?? "error"}`.slice(0, 120));
    return body.result;
  };
}

const pad = (address: string) => `0x${address.toLowerCase().slice(2).padStart(64, "0")}`;
const hex = (value: bigint) => `0x${value.toString(16)}`;
const topicAddress = (topic: string) => `0x${topic.slice(26).toLowerCase()}`;

/** The IO half against Sonic: one window read per call. */
export function readHoldWindow(rpc: Rpc = jsonRpc(SONIC_LOGS_RPC)): HoldVerifier {
  return async (query) => {
    try {
      const receipt = (await rpc("eth_getTransactionReceipt", [query.startTx])) as {
        blockNumber?: string;
        logs?: { address?: string; topics?: string[]; logIndex?: string }[];
      } | null;
      if (!receipt?.blockNumber) return { verdict: "unknown", error: "buy receipt not found" };
      const fromBlock = BigInt(receipt.blockNumber);
      // The delivery itself: the listing's Transfer to the holder in the fill. Without it (the window starts
      // at an intent), the whole block counts as after the buy.
      const delivery = (receipt.logs ?? []).find(
        (log) =>
          (log.address ?? "").toLowerCase() === query.listing.toLowerCase() &&
          (log.topics?.[0] ?? "").toLowerCase() === TRANSFER_TOPIC &&
          log.topics?.[2] &&
          topicAddress(log.topics[2]) === query.holder.toLowerCase(),
      );
      const start = delivery?.logIndex ? { block: fromBlock, logIndex: Number(BigInt(delivery.logIndex)) } : undefined;
      const head = BigInt((await rpc("eth_blockNumber", [])) as string);
      const toBlock = head - CONFIRMATIONS;
      if (toBlock < fromBlock) return { verdict: "unknown", error: "buy too recent" };
      const data = `0x70a08231${pad(query.holder).slice(2)}`;
      const balanceNow = BigInt((await rpc("eth_call", [{ to: query.listing, data }, hex(toBlock)])) as string);
      const logs: { blockNumber: string; logIndex: string; topics: string[]; data: string }[] = [];
      for (let start = fromBlock; start <= toBlock; start += LOG_CHUNK_BLOCKS) {
        const end = start + LOG_CHUNK_BLOCKS - 1n < toBlock ? start + LOG_CHUNK_BLOCKS - 1n : toBlock;
        const range = { fromBlock: hex(start), toBlock: hex(end), address: query.listing };
        const [out, into] = (await Promise.all([
          rpc("eth_getLogs", [{ ...range, topics: [TRANSFER_TOPIC, pad(query.holder)] }]),
          rpc("eth_getLogs", [{ ...range, topics: [TRANSFER_TOPIC, null, pad(query.holder)] }]),
        ])) as (typeof logs)[];
        logs.push(...out, ...into);
      }
      const seen = new Set<string>();
      const unique = logs.filter((log) => {
        const id = `${log.blockNumber}:${log.logIndex}`;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      const times = new Map<string, number>();
      for (const block of new Set(unique.map((log) => log.blockNumber))) {
        const header = (await rpc("eth_getBlockByNumber", [block, false])) as { timestamp?: string } | null;
        if (!header?.timestamp) return { verdict: "unknown", error: "block time not read" };
        times.set(block, Number(BigInt(header.timestamp)) * 1000);
      }
      const events: TransferEvent[] = unique.map((log) => ({
        block: BigInt(log.blockNumber),
        logIndex: Number(BigInt(log.logIndex)),
        from: topicAddress(log.topics[1]),
        to: topicAddress(log.topics[2]),
        value: BigInt(log.data && log.data !== "0x" ? log.data : "0x0"),
        at: times.get(log.blockNumber)!,
      }));
      const lowest = lowestBalance(balanceNow, events, query.holder, query.until.getTime(), start);
      const verdict = judgeWindow(query.quantity, lowest);
      if (verdict === "unknown") return { verdict, error: "quantity not read" };
      return {
        verdict,
        balanceRaw: balanceNow.toString(),
        lowestRaw: lowest.toString(),
        outflows: events.filter((event) => event.from === query.holder.toLowerCase()).length,
        fromBlock: fromBlock.toString(),
        toBlock: toBlock.toString(),
      };
    } catch (error) {
      return { verdict: "unknown", error: error instanceof Error ? error.message.slice(0, 120) : "error" };
    }
  };
}
