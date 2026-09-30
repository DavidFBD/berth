import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, getAbiItem, type Log } from "viem";
import { IntentsAbi, type IntentResponse } from "@sodax/sdk";
import { setSqlClient, type SqlClient } from "./db";
import { makeTestDb } from "./pglite-test-db";
import { fillsIntent, savePourClaim, settlePourClaims, verdictFromRecord } from "./pour-claims";

const CONTRACT = "0x6382d6ccd780758c5e8a6123c33ee8f4472f96ef";
const HASH = `0x${"11".repeat(32)}` as const;

function filledLog(intentHash: `0x${string}`, remaining: bigint, address = CONTRACT): Log {
  const event = getAbiItem({ abi: IntentsAbi, name: "IntentFilled" });
  const indexed = event.inputs.filter((input) => "indexed" in input && input.indexed);
  const plain = event.inputs.filter((input) => !("indexed" in input && input.indexed));
  const values: Record<string, unknown> = {
    intentHash,
    intentState: { exists: true, remainingInput: remaining, receivedOutput: 5n, pendingPayment: false },
  };
  const topics = encodeEventTopics({
    abi: IntentsAbi,
    eventName: "IntentFilled",
    args: Object.fromEntries(indexed.map((input) => [input.name!, values[input.name!]])) as never,
  });
  const data = encodeAbiParameters(plain, plain.map((input) => values[input.name!]) as never);
  return { address, topics, data, blockHash: null, blockNumber: null, logIndex: null, transactionHash: null, transactionIndex: null, removed: false } as unknown as Log;
}

describe("fillsIntent", () => {
  it("is true only for this intent, filled whole, by the Intents contract, in a receipt that succeeded", () => {
    expect(fillsIntent({ status: "success", logs: [filledLog(HASH, 0n)] }, HASH, CONTRACT)).toBe(true);
    expect(fillsIntent({ status: "success", logs: [filledLog(HASH, 3n)] }, HASH, CONTRACT)).toBe(false);
    expect(fillsIntent({ status: "success", logs: [filledLog(`0x${"22".repeat(32)}`, 0n)] }, HASH, CONTRACT)).toBe(false);
    expect(fillsIntent({ status: "success", logs: [filledLog(HASH, 0n, "0x0000000000000000000000000000000000000001")] }, HASH, CONTRACT)).toBe(false);
    expect(fillsIntent({ status: "reverted", logs: [filledLog(HASH, 0n)] }, HASH, CONTRACT)).toBe(false);
    expect(fillsIntent(null, HASH, CONTRACT)).toBe(false);
  });
});

const record = (over: Partial<IntentResponse> & { events?: unknown[] }): IntentResponse =>
  ({ open: true, intent: { deadline: "0", inputAmount: "10" }, events: [], ...over }) as unknown as IntentResponse;

describe("verdictFromRecord", () => {
  it("pays a fill, refuses a cancel or expiry, and waits on anything open or unknown", () => {
    expect(verdictFromRecord(record({ open: false, events: [{ eventType: "intent-filled", txHash: "0xf", intentState: { remainingInput: "0", receivedOutput: "1" } }] }))).toBe("filled");
    expect(verdictFromRecord(record({ open: false, events: [{ eventType: "intent-cancelled", txHash: "0xc" }] }))).toBe("notFilled");
    expect(verdictFromRecord(record({}))).toBe("unknown");
    expect(verdictFromRecord(null)).toBe("unknown");
  });
});

let sql: SqlClient;
let close: () => Promise<void>;
beforeAll(async () => {
  const db = await makeTestDb();
  sql = db.sql;
  close = db.close;
  setSqlClient(sql);
});
afterAll(async () => {
  setSqlClient(null);
  await close();
});

describe("claims the evening settles", () => {
  it("pays a claim once it fills, drops one that closed unfilled, and keeps one still waiting", async () => {
    const rows = (await sql.query(`insert into users (wallet_address) values ('0xclaim') returning id`)) as { id: string }[];
    const userId = rows[0].id;
    await savePourClaim(userId, "0xFILLED", "buy", null);
    await savePourClaim(userId, "0xcancelled", "buy", null);
    await savePourClaim(userId, "0xwaiting", "sell", null);
    await savePourClaim(userId, "0xfilled", "buy", "0xfilltx");
    const verdicts: Record<string, "filled" | "notFilled" | "unknown"> = { "0xfilled": "filled", "0xcancelled": "notFilled", "0xwaiting": "unknown" };
    const pay = vi.fn(async () => true);
    const summary = await settlePourClaims({ verdictOf: async (tx) => verdicts[tx], pay });
    expect(summary).toEqual({ checked: 3, paid: 1, dropped: 1 });
    expect(pay).toHaveBeenCalledTimes(1);
    expect(pay.mock.calls[0]).toEqual([expect.objectContaining({ intent_tx: "0xfilled", fill_tx: "0xfilltx", direction: "buy" })]);
    const again = await settlePourClaims({ verdictOf: async (tx) => verdicts[tx], pay });
    expect(again).toEqual({ checked: 1, paid: 0, dropped: 0 });
    expect(pay).toHaveBeenCalledTimes(1);
  });
});

describe("a claim keeps its listing", () => {
  it("as first told, whatever a replay says, and never for another account", async () => {
    const rows = (await sql.query(`insert into users (wallet_address) values ('0xlisting') returning id`)) as { id: string }[];
    const userId = rows[0].id;
    await savePourClaim(userId, "0xlisted", "buy", null, "NVDA");
    await savePourClaim(userId, "0xlisted", "buy", "0xfill", "TSLA");
    await savePourClaim(userId, "0xunlisted", "buy", null);
    await savePourClaim(userId, "0xunlisted", "buy", null, "AAPL");
    expect(await sql.query(`select intent_tx, listing_symbol, fill_tx from pour_claims where user_id = $1 order by intent_tx`, [userId])).toEqual([
      { intent_tx: "0xlisted", listing_symbol: "NVDA", fill_tx: "0xfill" },
      { intent_tx: "0xunlisted", listing_symbol: "AAPL", fill_tx: null },
    ]);
  });
});

describe("claims that cannot be paid yet", () => {
  it("stay open when the order row cannot be written, rotate to the back, and stop at the budget", async () => {
    const rows = (await sql.query(`insert into users (wallet_address) values ('0xclaim2') returning id`)) as { id: string }[];
    const userId = rows[0].id;
    await savePourClaim(userId, "0xnorow", "buy", null);
    await savePourClaim(userId, "0xnext", "buy", null);
    const unpaid = vi.fn(async () => false);
    const first = await settlePourClaims({ verdictOf: async () => "filled", pay: unpaid });
    expect(first.paid).toBe(0);
    const open = (await sql.query(`select intent_tx from pour_claims where settled_at is null and user_id = $1 order by intent_tx`, [userId])) as { intent_tx: string }[];
    expect(open.map((row) => row.intent_tx)).toEqual(["0xnext", "0xnorow"]);

    // A budget already spent starts nothing.
    let t = 0;
    const none = await settlePourClaims({ verdictOf: async () => "filled", pay: unpaid, budgetMs: 5, clock: () => (t += 10) });
    expect(none.paid).toBe(0);
    expect(unpaid).toHaveBeenCalledTimes(first.checked);

    const { closePourClaim } = await import("./pour-claims");
    await closePourClaim("0xNOROW");
    const still = (await sql.query(`select intent_tx from pour_claims where settled_at is null and user_id = $1`, [userId])) as { intent_tx: string }[];
    expect(still.map((row) => row.intent_tx)).toEqual(["0xnext"]);
  });
});
