import { describe, expect, it } from "vitest";
import { CONFIRMATIONS, DEFAULT_SONIC_LOGS_RPC, LOG_CHUNK_BLOCKS, LOG_CHUNK_CONCURRENCY, judgeWindow, lowestBalance, readHoldWindow, type TransferEvent } from "./hold-window";

/** The hold window: the balance walked back from today's through every transfer since the buy, and its read on Sonic (mocked RPC). */

const HOLDER = "0x00000000000000000000000000000000000000aa";
const OTHER = "0x00000000000000000000000000000000000000bb";
const UNIT = 10n ** 16n; // 0.01 of a listing
const t = (day: number) => Date.UTC(2026, 9, day);
const ev = (block: number, from: string, to: string, value: bigint, day: number): TransferEvent => ({ block: BigInt(block), logIndex: 0, from, to, value, at: t(day) });

describe("lowestBalance", () => {
  it("is today's balance when nothing moved after the buy", () => {
    expect(lowestBalance(5n * UNIT, [ev(1, OTHER, HOLDER, 5n * UNIT, 3)], HOLDER, t(10))).toBe(5n * UNIT);
  });

  it("sees a sale and a buy back before the check", () => {
    const events = [ev(1, OTHER, HOLDER, 5n * UNIT, 3), ev(2, HOLDER, OTHER, 5n * UNIT, 3), ev(3, OTHER, HOLDER, 5n * UNIT, 9)];
    expect(lowestBalance(5n * UNIT, events, HOLDER, t(10))).toBe(0n);
  });

  it("ignores what happened after the hold ended", () => {
    const events = [ev(1, OTHER, HOLDER, 5n * UNIT, 3), ev(2, HOLDER, OTHER, 5n * UNIT, 12)];
    expect(lowestBalance(0n, events, HOLDER, t(10))).toBe(5n * UNIT);
  });

  it("lets an earlier holding cover a partial sale", () => {
    // Held 10 before, bought 5 (15), sold 7 (8): still at least 5.
    const events = [ev(1, OTHER, HOLDER, 5n * UNIT, 3), ev(2, HOLDER, OTHER, 7n * UNIT, 5)];
    expect(lowestBalance(8n * UNIT, events, HOLDER, t(10))).toBe(8n * UNIT);
    expect(judgeWindow("0.05", 8n * UNIT)).toBe("held");
    expect(judgeWindow("0.05", 4n * UNIT)).toBe("not_held");
    expect(judgeWindow("x", 4n * UNIT)).toBe("unknown");
  });
});

describe("lowestBalance from the delivery log", () => {
  it("Q5: a transfer earlier in the buy's own block is before the buy, not a dip in the hold", () => {
    const events = [
      { block: 10n, logIndex: 0, from: HOLDER, to: OTHER, value: 100n, at: t(3) },
      { block: 10n, logIndex: 5, from: OTHER, to: HOLDER, value: 50n, at: t(3) },
    ];
    expect(lowestBalance(50n, events, HOLDER, t(10))).toBe(0n);
    expect(lowestBalance(50n, events, HOLDER, t(10), { block: 10n, logIndex: 5 })).toBe(50n);
  });
});

describe("readHoldWindow", () => {
  const pad = (a: string) => `0x${a.slice(2).padStart(64, "0")}`;
  const TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  // The window ends at 0x200, CONFIRMATIONS behind the head.
  const HEAD = 0x200n + CONFIRMATIONS;
  const END = `0x${(HEAD - CONFIRMATIONS).toString(16)}`;
  /** Every log's block on the 4th; the window's last block after the hold's end on the 10th. */
  const headerAt = (block: unknown, end = END) => ({ timestamp: `0x${((block === end ? t(11) : t(4)) / 1000).toString(16)}` });
  type Log = { blockNumber: string; logIndex: string; topics: string[]; data: string };
  const log = (block: number, from: string, to: string, value: bigint, index = 0): Log => ({
    blockNumber: `0x${block.toString(16)}`,
    logIndex: `0x${index.toString(16)}`,
    topics: [TOPIC, pad(from), pad(to)],
    data: `0x${value.toString(16)}`,
  });
  /** A chain where `logs` happened and the holder holds `balance` at every block from the last log on; it answers only up to `served`. */
  function rpcWith(logs: Log[], balance: bigint, { served = HEAD, calls = [] as [string, unknown[]][] } = {}) {
    return async (method: string, params: unknown[]) => {
      calls.push([method, params]);
      if (method === "eth_getTransactionReceipt") return { blockNumber: "0x10", logs: [{ address: OTHER, topics: [TOPIC, pad(STRANGER), pad(HOLDER)], logIndex: "0x3" }] };
      if (method === "eth_blockNumber") return `0x${HEAD.toString(16)}`;
      if (method === "eth_call") return `0x${balance.toString(16)}`;
      if (method === "eth_getBlockByNumber") return headerAt(params[0]);
      if (method === "eth_getLogs") {
        const filter = params[0] as { topics: (string | null)[]; toBlock: string };
        const upTo = BigInt(filter.toBlock) < served ? BigInt(filter.toBlock) : served;
        return logs.filter((entry) => BigInt(entry.blockNumber) <= upTo && (filter.topics[1] ? entry.topics[1] === filter.topics[1] : entry.topics[2] === filter.topics[2]));
      }
      throw new Error(method);
    };
  }
  const STRANGER = "0x00000000000000000000000000000000000000ee";
  const query = { holder: HOLDER, listing: OTHER, startTx: "0x01", quantity: "0.05", until: new Date(t(10)) };

  it("reads the window and finds an outflow that broke the hold", async () => {
    const logs = [log(0x10, STRANGER, HOLDER, 5n * UNIT, 3), log(0x11, HOLDER, STRANGER, 5n * UNIT)];
    expect(await readHoldWindow(rpcWith(logs, 0n))(query)).toMatchObject({ verdict: "not_held", lowestRaw: "0", outflows: 1 });
  });

  it("holds when nothing left", async () => {
    const logs = [log(0x10, STRANGER, HOLDER, 5n * UNIT, 3)];
    expect(await readHoldWindow(rpcWith(logs, 5n * UNIT))(query)).toMatchObject({ verdict: "held", outflows: 0 });
  });

  it("Q6: reads the logs and the balance at the same block, behind the head", async () => {
    const calls: [string, unknown[]][] = [];
    await readHoldWindow(rpcWith([log(0x10, STRANGER, HOLDER, 5n * UNIT, 3)], 5n * UNIT, { calls }))(query);
    const at = `0x${(HEAD - CONFIRMATIONS).toString(16)}`;
    expect(calls.find(([method]) => method === "eth_call")![1][1]).toBe(at);
    for (const [, params] of calls.filter(([method]) => method === "eth_getLogs")) expect((params[0] as { toBlock: string }).toBlock).toBe(at);
  });

  it("starts the walk at the delivery log, from the fill's receipt", async () => {
    // Earlier in the same block the holder sent its old 1.00 away: not a dip in the hold.
    const logs = [log(0x10, HOLDER, STRANGER, 100n * UNIT, 0), log(0x10, STRANGER, HOLDER, 5n * UNIT, 3)];
    expect(await readHoldWindow(rpcWith(logs, 5n * UNIT))(query)).toMatchObject({ verdict: "held", lowestRaw: (5n * UNIT).toString() });
  });

  it("answers unknown when the RPC fails or the buy is too recent, never a verdict", async () => {
    const failed = await readHoldWindow(async () => {
      throw new Error("rpc http 503");
    })(query);
    expect(failed).toEqual({ verdict: "unknown", error: "rpc http 503" });
    const recent = await readHoldWindow(async (method) => (method === "eth_getTransactionReceipt" ? { blockNumber: "0x1f0" } : method === "eth_blockNumber" ? "0x200" : null))(query);
    expect(recent).toEqual({ verdict: "unknown", error: "buy too recent" });
  });
  it("reads a long window in contiguous chunks no wider than the endpoint's log range, and finds a late outflow", async () => {
    const from = 0x10n;
    const head = from + 2n * LOG_CHUNK_BLOCKS + 20_000n + CONFIRMATIONS;
    const toBlock = head - CONFIRMATIONS;
    const late = toBlock - 5n;
    const ranges: [bigint, bigint][] = [];
    const rpc = async (method: string, params: unknown[]) => {
      if (method === "eth_getTransactionReceipt") return { blockNumber: `0x${from.toString(16)}`, logs: [] };
      if (method === "eth_blockNumber") return `0x${head.toString(16)}`;
      if (method === "eth_call") return "0x0";
      if (method === "eth_getBlockByNumber") return headerAt(params[0], `0x${toBlock.toString(16)}`);
      if (method === "eth_getLogs") {
        const filter = params[0] as { fromBlock: string; toBlock: string; topics: (string | null)[] };
        const range: [bigint, bigint] = [BigInt(filter.fromBlock), BigInt(filter.toBlock)];
        if (filter.topics[1]) ranges.push(range);
        if (range[1] - range[0] + 1n > LOG_CHUNK_BLOCKS) throw new Error("exceed maximum block range");
        const all = [log(Number(from), STRANGER, HOLDER, 5n * UNIT, 3), log(Number(late), HOLDER, STRANGER, 5n * UNIT)];
        return all.filter(
          (entry) =>
            BigInt(entry.blockNumber) >= range[0] &&
            BigInt(entry.blockNumber) <= range[1] &&
            (filter.topics[1] ? entry.topics[1] === filter.topics[1] : entry.topics[2] === filter.topics[2]),
        );
      }
      throw new Error(method);
    };
    expect(await readHoldWindow(rpc)(query)).toMatchObject({ verdict: "not_held", outflows: 1, fromBlock: from.toString(), toBlock: toBlock.toString() });
    expect(ranges).toHaveLength(3);
    expect(ranges[0][0]).toBe(from);
    expect(ranges[ranges.length - 1][1]).toBe(toBlock);
    for (let index = 1; index < ranges.length; index += 1) expect(ranges[index][0]).toBe(ranges[index - 1][1] + 1n);
    expect(LOG_CHUNK_BLOCKS).toBeLessThanOrEqual(50_000n);
  });

  it("does not judge a hold whose end is not yet CONFIRMATIONS behind the head, and does not call it unreadable", async () => {
    const logs = [log(0x10, STRANGER, HOLDER, 5n * UNIT, 3)];
    const early = { ...query, until: new Date(t(12)) };
    expect(await readHoldWindow(rpcWith(logs, 5n * UNIT))(early)).toEqual({ verdict: "unknown", error: "hold end not yet confirmed", pending: true });
  });

  it("keeps a wide confirmation margin: a lagging node of a load balancer answers short log ranges without an error", () => {
    expect(CONFIRMATIONS).toBeGreaterThanOrEqual(3_000n);
  });

  it("gives up as unknown once its deadline has passed, asking nothing more", async () => {
    const calls: [string, unknown[]][] = [];
    const past = await readHoldWindow(rpcWith([], 0n, { calls }))(query, { deadline: Date.now() - 1 });
    expect(past).toEqual({ verdict: "unknown", error: "deadline passed", pending: true });
    expect(calls).toHaveLength(0);
  });

  it("aborts a read still in flight at the deadline and answers unknown", async () => {
    const hung = async (method: string, params: unknown[], signal?: AbortSignal) => {
      if (method === "eth_getLogs") {
        return new Promise((_, reject) => signal?.addEventListener("abort", () => reject(new Error("aborted"))));
      }
      return rpcWith([], 5n * UNIT)(method, params);
    };
    const started = Date.now();
    const reading = await readHoldWindow(hung)(query, { deadline: Date.now() + 60 });
    expect(reading).toEqual({ verdict: "unknown", error: "deadline passed", pending: true });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("reads the log chunks three at a time", async () => {
    const from = 0x10n;
    const head = from + 6n * LOG_CHUNK_BLOCKS + CONFIRMATIONS;
    const end = `0x${(head - CONFIRMATIONS).toString(16)}`;
    let inFlight = 0;
    let most = 0;
    const rpc = async (method: string, params: unknown[]) => {
      if (method === "eth_getTransactionReceipt") return { blockNumber: `0x${from.toString(16)}`, logs: [] };
      if (method === "eth_blockNumber") return `0x${head.toString(16)}`;
      if (method === "eth_call") return `0x${(5n * UNIT).toString(16)}`;
      if (method === "eth_getBlockByNumber") return headerAt(params[0], end);
      if (method === "eth_getLogs") {
        if ((params[0] as { topics: (string | null)[] }).topics[1] === null) return [];
        inFlight += 1;
        most = Math.max(most, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return [];
      }
      throw new Error(method);
    };
    expect(await readHoldWindow(rpc)(query)).toMatchObject({ verdict: "held" });
    expect(LOG_CHUNK_CONCURRENCY).toBe(3);
    expect(most).toBe(3);
  });

  it("reads Sonic from one endpoint by default, not the dead soniclabs one", () => {
    expect(DEFAULT_SONIC_LOGS_RPC).toBe("https://sonic-rpc.publicnode.com");
  });
});
