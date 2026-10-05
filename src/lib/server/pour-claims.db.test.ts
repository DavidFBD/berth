import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, getAbiItem, type Log } from "viem";
import { IntentsAbi, type IntentResponse } from "@sodax/sdk";
import { setSqlClient, type SqlClient } from "./db";
import { makeTestDb } from "./pglite-test-db";
import { fillsIntent, forgoHold, payRecordedClaim, savePourClaim, settlePourClaims, verdictFromRecord, type SettledClaim } from "./pour-claims";
import { isNoXp, markNoXp, pourPaid } from "./no-xp";

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
    expect(summary).toEqual({ checked: 3, paid: 1, dropped: 1, recorded: 0, refused: 0, failed: 0 });
    expect(pay).toHaveBeenCalledTimes(1);
    expect(pay.mock.calls[0]).toEqual([expect.objectContaining({ intent_tx: "0xfilled", fill_tx: "0xfilltx", direction: "buy" })]);
    const again = await settlePourClaims({ verdictOf: async (tx) => verdicts[tx], pay });
    expect(again).toEqual({ checked: 1, paid: 0, dropped: 0, recorded: 0, refused: 0, failed: 0 });
    expect(pay).toHaveBeenCalledTimes(1);
  });
});

describe("a claim that throws", () => {
  it("is logged and left open at the back of the line, and never stops the claims behind it", async () => {
    await sql.query(`update pour_claims set settled_at = now() where settled_at is null`);
    const rows = (await sql.query(`insert into users (wallet_address) values ('0xthrows') returning id`)) as { id: string }[];
    const userId = rows[0].id;
    await savePourClaim(userId, "0xbad", "buy", null);
    await savePourClaim(userId, "0xgood", "buy", null);
    await sql.query(`update pour_claims set created_at = now() - interval '1 hour' where intent_tx = '0xbad'`);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const pay = vi.fn(async (claim: SettledClaim) => {
      if (claim.intent_tx === "0xbad") throw new Error("column delivery_ok does not exist");
      return true;
    });
    const summary = await settlePourClaims({ verdictOf: async () => "filled", pay });
    expect(summary).toEqual({ checked: 2, paid: 1, dropped: 0, recorded: 0, refused: 0, failed: 1 });
    expect(warn).toHaveBeenCalledWith("[pour-claims] claim failed", "0xbad", "column delivery_ok does not exist");
    warn.mockRestore();
    expect(await sql.query(`select intent_tx, settled_at is null as open, last_checked_at is not null as looked from pour_claims where user_id = $1 order by intent_tx`, [userId])).toEqual([
      { intent_tx: "0xbad", open: true, looked: true },
      { intent_tx: "0xgood", open: false, looked: true },
    ]);
    // The next night it is behind any claim not yet looked at.
    await savePourClaim(userId, "0xnew", "buy", null);
    const order: string[] = [];
    await settlePourClaims({
      verdictOf: async (tx) => {
        order.push(tx);
        return "unknown";
      },
      pay,
    });
    expect(order.indexOf("0xnew")).toBeLessThan(order.indexOf("0xbad"));
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

describe("a buy recorded where Berth is not available", () => {
  const newUser = async (wallet: string) =>
    ((await sql.query(`insert into users (wallet_address) values ($1) returning id`, [wallet])) as { id: string }[])[0].id;
  const orderFor = (userId: string, tx: string) =>
    sql.query(
      `insert into orders (user_id, intent_tx, direction, listing_symbol, listing_address, quantity, delivered_to, created_at)
       values ($1, $2, 'buy', 'NVDA', '0x${"b".repeat(40)}', 1, '0x${"a".repeat(40)}', now() - interval '40 days')`,
      [userId, tx],
    );

  it("is marked once by intent, and the mark is permanent", async () => {
    expect(await isNoXp("0xMARK1")).toBe(false);
    await markNoXp("0xMARK1");
    await markNoXp("0xmark1");
    expect(await isNoXp("0xmark1")).toBe(true);
    expect(await sql.query(`select count(*)::int as n from no_xp_intents where intent_tx = '0xmark1'`)).toEqual([{ n: 1 }]);
  });

  it("settles its claim in the evening as recorded, not paid, with its order standing, no XP and no hold", async () => {
    const userId = await newUser("0xaway1");
    await savePourClaim(userId, "0xawayclaim", "buy", null, "NVDA");
    await savePourClaim(userId, "0xhomeclaim", "buy", null, "NVDA");
    await markNoXp("0xawayclaim");
    const pay = vi.fn(async (claim: SettledClaim) => {
      await orderFor(userId, claim.intent_tx);
      return payRecordedClaim(claim);
    });
    const mine = new Set(["0xawayclaim", "0xhomeclaim"]);
    const summary = await settlePourClaims({ limit: 50, verdictOf: async (tx) => (mine.has(tx) ? "filled" : "unknown"), pay });
    expect(summary).toMatchObject({ paid: 1, recorded: 1, refused: 0 });
    expect(pay).toHaveBeenCalledWith(expect.objectContaining({ intent_tx: "0xawayclaim", no_xp: true }));
    expect(await sql.query(`select intent_tx, outcome from pour_claims where user_id = $1 order by intent_tx`, [userId])).toEqual([
      { intent_tx: "0xawayclaim", outcome: "recorded_no_xp" },
      { intent_tx: "0xhomeclaim", outcome: "paid" },
    ]);
    const events = (await sql.query(`select ref from xp_events where user_id = $1 and kind = 'pour_in'`, [userId])) as { ref: string }[];
    expect(events.map((row) => row.ref)).toEqual(["0xhomeclaim"]);
    expect(await sql.query(`select intent_tx, hold_outcome from orders where user_id = $1 order by intent_tx`, [userId])).toEqual([
      { intent_tx: "0xawayclaim", hold_outcome: "forfeit" },
      { intent_tx: "0xhomeclaim", hold_outcome: null },
    ]);
  });

  it("pays nothing even when the claim itself does not say so: the mark is read at payment", async () => {
    const userId = await newUser("0xaway2");
    await orderFor(userId, "0xlatemark");
    await markNoXp("0xlatemark");
    expect(await payRecordedClaim({ user_id: userId, intent_tx: "0xlatemark", direction: "buy", referred_by: null, fill_tx: null })).toBe(
      "recorded_no_xp",
    );
    expect(await pourPaid("0xlatemark")).toBe(false);
  });

  it("is never offered to the daily hold check, even if an order path left its hold unjudged", async () => {
    const userId = await newUser("0xaway3");
    await orderFor(userId, "0xunjudged");
    await orderFor(userId, "0xjudgeme");
    await markNoXp("0xunjudged");
    const { holdCandidates } = await import("./holds");
    const scope = { listingAddresses: [`0x${"b".repeat(40)}`] };
    const candidates = await holdCandidates(new Date(), 50, scope as never);
    const mine = candidates.filter((candidate) => candidate.userId === userId).map((candidate) => candidate.intentTx);
    expect(mine).toEqual(["0xjudgeme"]);
  });

  it("forgoHold is idempotent and keeps an earlier verdict", async () => {
    const userId = await newUser("0xaway4");
    await orderFor(userId, "0xjudged");
    await sql.query(`update orders set hold_checked_at = now(), hold_outcome = 'paid' where intent_tx = '0xjudged'`);
    await forgoHold("0xJUDGED");
    expect(await sql.query(`select hold_outcome from orders where intent_tx = '0xjudged'`)).toEqual([{ hold_outcome: "paid" }]);
  });
});
