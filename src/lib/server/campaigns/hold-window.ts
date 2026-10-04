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
 * plain JSON-RPC against one Sonic endpoint, chunked to its log range).
 * Anything that cannot be read is "unknown": no verdict, tried
 * again the next morning. Nothing is ever judged on doubt.
 */

/**
 * ONE endpoint per check, never a failover list: the logs and the balance
 * must come from the same backend for CONFIRMATIONS to hold, so a check that
 * cannot finish on it is "unknown" and is tried again the next morning.
 * rpc.soniclabs.com (the old choice) answered 503 to everything on
 * 2026-10-04, so no hold was judged. Overridable with SONIC_LOGS_RPC.
 */
export const DEFAULT_SONIC_LOGS_RPC = "https://sonic-rpc.publicnode.com";
export const SONIC_LOGS_RPC = process.env.SONIC_LOGS_RPC?.trim() || DEFAULT_SONIC_LOGS_RPC;
/**
 * Blocks per eth_getLogs call, both ends inclusive. publicnode refuses a
 * range wider than 50,000 (measured 2026-10-04: -32701 "exceed maximum
 * block range: 50000" at 60k, answered at 50,001). Sonic makes about 58k
 * blocks a day, so a 30 day hold is some 35 chunks.
 */
export const LOG_CHUNK_BLOCKS = 50_000n;
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const LISTING_DECIMALS = 18;
/**
 * Blocks behind the head the window ends at. Logs and the balance are read
 * at the same block, this far back, so a node of a load balanced RPC that
 * has not seen the newest blocks cannot hand over a balance that includes
 * a transfer its logs leave out. publicnode is such a balancer, and a node
 * behind answers a log range past its own head with what it has, no error
 * (measured 2026-10-04), so the margin is wide: 3,000 blocks, some 75
 * minutes at Sonic's 58k blocks a day, far past any lag seen. A hold whose
 * end is not yet that far back is not judged (`pending`), and the morning
 * asks again the next day.
 */
export const CONFIRMATIONS = 3_000n;
/** Log chunks (and block header reads) read at once in one window. */
export const LOG_CHUNK_CONCURRENCY = 3;

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
  | {
      verdict: "unknown";
      error: string;
      /**
       * Not a failed read: the hold's end is not yet CONFIRMATIONS behind the
       * head (too early), or the read was cut by its deadline (out of time).
       * Asked again another morning; never counts toward hold_unreadable.
       */
      pending?: true;
    };

export type HoldVerifier = (
  query: HoldQuery,
  options?: {
    /** Epoch ms after which the read gives up as "unknown", in flight requests aborted. */
    deadline?: number;
  },
) => Promise<HoldReading>;

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

type Rpc = (method: string, params: unknown[], signal?: AbortSignal) => Promise<unknown>;

export function jsonRpc(url: string, fetcher: typeof fetch = fetch): Rpc {
  return async (method, params, signal) => {
    const response = await fetcher(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: signal ? AbortSignal.any([AbortSignal.timeout(10_000), signal]) : AbortSignal.timeout(10_000),
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

/** `work` over `items`, `size` at a time, results in order. */
async function inBatches<T, R>(items: readonly T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let index = 0; index < items.length; index += size) out.push(...(await Promise.all(items.slice(index, index + size).map(work))));
  return out;
}

/**
 * The IO half against Sonic: one window read per call. With a deadline,
 * the read stops there (requests in flight aborted, none started after)
 * and answers "unknown", so one long window cannot hold the morning's
 * campaign stage past its turn.
 */
export function readHoldWindow(rpc0: Rpc = jsonRpc(SONIC_LOGS_RPC), clock: () => number = Date.now): HoldVerifier {
  return async (query, { deadline = Number.POSITIVE_INFINITY } = {}) => {
    const left = deadline - clock();
    if (left <= 0) return { verdict: "unknown", error: "deadline passed", pending: true };
    const stop = Number.isFinite(left) ? AbortSignal.timeout(left) : undefined;
    const rpc = (method: string, params: unknown[]) => {
      if (clock() > deadline || stop?.aborted) throw new Error("deadline passed");
      return rpc0(method, params, stop);
    };
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
      // The window must reach the hold's end: a transfer between its last
      // block and the end would go unread. Too early is not a failed read.
      const endHeader = (await rpc("eth_getBlockByNumber", [hex(toBlock), false])) as { timestamp?: string } | null;
      if (!endHeader?.timestamp) return { verdict: "unknown", error: "block time not read" };
      if (Number(BigInt(endHeader.timestamp)) * 1000 < query.until.getTime()) {
        return { verdict: "unknown", error: "hold end not yet confirmed", pending: true };
      }
      const data = `0x70a08231${pad(query.holder).slice(2)}`;
      const balanceNow = BigInt((await rpc("eth_call", [{ to: query.listing, data }, hex(toBlock)])) as string);
      type RawLog = { blockNumber: string; logIndex: string; topics: string[]; data: string };
      const ranges: { fromBlock: string; toBlock: string; address: string }[] = [];
      for (let start = fromBlock; start <= toBlock; start += LOG_CHUNK_BLOCKS) {
        const end = start + LOG_CHUNK_BLOCKS - 1n < toBlock ? start + LOG_CHUNK_BLOCKS - 1n : toBlock;
        ranges.push({ fromBlock: hex(start), toBlock: hex(end), address: query.listing });
      }
      const chunks = await inBatches(ranges, LOG_CHUNK_CONCURRENCY, async (range) => {
        const [out, into] = (await Promise.all([
          rpc("eth_getLogs", [{ ...range, topics: [TRANSFER_TOPIC, pad(query.holder)] }]),
          rpc("eth_getLogs", [{ ...range, topics: [TRANSFER_TOPIC, null, pad(query.holder)] }]),
        ])) as RawLog[][];
        return [...out, ...into];
      });
      const logs = chunks.flat();
      const seen = new Set<string>();
      const unique = logs.filter((log) => {
        const id = `${log.blockNumber}:${log.logIndex}`;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      const times = new Map<string, number>();
      const blocks = [...new Set(unique.map((log) => log.blockNumber))];
      const headers = await inBatches(blocks, LOG_CHUNK_CONCURRENCY, async (block) => {
        const header = (await rpc("eth_getBlockByNumber", [block, false])) as { timestamp?: string } | null;
        return [block, header?.timestamp] as const;
      });
      for (const [block, timestamp] of headers) {
        if (!timestamp) return { verdict: "unknown", error: "block time not read" };
        times.set(block, Number(BigInt(timestamp)) * 1000);
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
      // Out of time is not unreadable: a long window on a slow morning must
      // not lose its claim to the seven day release.
      if (stop?.aborted || clock() > deadline) return { verdict: "unknown", error: "deadline passed", pending: true };
      return { verdict: "unknown", error: error instanceof Error ? error.message.slice(0, 120) : "error" };
    }
  };
}
