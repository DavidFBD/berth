import { describe, expect, it } from "vitest";
import { CONFIRMATIONS, judgeWindow, lowestBalance, readHoldWindow, type TransferEvent } from "./hold-window";

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
  const HEAD = 0x200n;
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
      if (method === "eth_getBlockByNumber") return { timestamp: `0x${(t(4) / 1000).toString(16)}` };
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
});
