import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { IntentResponse } from "@sodax/sdk";
import { TOKEN_LISTINGS } from "@/lib/listings";
import { setSqlClient, type SqlClient } from "./db";
import { makeTestDb } from "./pglite-test-db";
import { judgeLimitIntent, keptPrice, limitOrdersOn, listLimitOrders, markCancelAsked, syncWaitingOrders } from "./limit-orders";

let sql: SqlClient;
let close: () => Promise<void>;
let userId: string;

const NVDA = TOKEN_LISTINGS.find((listing) => listing.symbol === "NVDA")!.address.toLowerCase();

beforeAll(async () => {
  const db = await makeTestDb();
  sql = db.sql;
  close = db.close;
  setSqlClient(sql);
  const rows = (await sql.query(`insert into users (wallet_address) values ('0xaaaa') returning id`)) as { id: string }[];
  userId = rows[0].id;
});

afterAll(async () => {
  setSqlClient(null);
  await close();
});

async function insertOrder(intentTx: string, over: Record<string, unknown> = {}) {
  const row = {
    direction: "buy",
    input_raw: "49800000",
    input_decimals: 6,
    min_output_raw: "249000000000000000",
    output_decimals: 18,
    limit_price: 200,
    expires_at: null,
    ...over,
  };
  await sql.query(
    `insert into limit_orders (user_id, intent_tx, direction, listing_symbol, listing_address, pay_symbol,
       input_raw, input_decimals, min_output_raw, output_decimals, limit_price, expires_at)
     values ($1,$2,$3,'NVDA',$4,'USDC',$5,$6,$7,$8,$9,$10)`,
    [userId, intentTx, row.direction, NVDA, row.input_raw, row.input_decimals, row.min_output_raw, row.output_decimals, row.limit_price, row.expires_at],
  );
}

const response = (over: Partial<IntentResponse> & { events?: unknown[] } = {}): IntentResponse =>
  ({
    intentHash: "0xh",
    txHash: "0xt",
    logIndex: 0,
    chainId: 146,
    blockNumber: 1,
    open: true,
    intent: {
      intentId: "1",
      creator: "0xhub",
      inputToken: "0xusdc",
      outputToken: NVDA,
      inputAmount: "49800000",
      minOutputAmount: "249000000000000000",
      deadline: "0",
      allowPartialFill: false,
      srcChain: 146,
      dstChain: 146,
      srcAddress: "0xhub",
      dstAddress: "0xhub",
      solver: "0x0",
      data: "0x",
    },
    events: [],
    ...over,
  }) as unknown as IntentResponse;

describe("the waiting list", () => {
  it("shows a resting order, keeps it resting while the backend has no record, and never puts it in orders", async () => {
    await insertOrder("0xrest");
    const views = await listLimitOrders(userId, { fetchRecord: async () => null });
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({ intentTx: "0xrest", status: "resting", limitPrice: 200, progress: 0, cancelAsked: false });
    expect(views[0].justClosed).toBeUndefined();
    const orders = (await sql.query(`select count(*)::int as n from orders`)) as { n: number }[];
    expect(orders[0].n).toBe(0);
  });

  it("marks a fill once, announces it once, and hands it to the fill recorder", async () => {
    const onFilled = vi.fn(async () => true);
    const filled = response({
      open: false,
      events: [{ eventType: "intent-filled", txHash: "0xfill", blockNumber: 2, intentState: { exists: true, remainingInput: "0", receivedOutput: "250000000000000000" } }],
    });
    const first = await listLimitOrders(userId, { fetchRecord: async () => filled, onFilled });
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ status: "filled", progress: 1, justClosed: true, fillTx: "0xfill", receivedRaw: "250000000000000000" });
    expect(onFilled).toHaveBeenCalledTimes(1);
    const again = await listLimitOrders(userId, { fetchRecord: async () => filled, onFilled });
    expect(again).toHaveLength(0);
    expect(onFilled).toHaveBeenCalledTimes(1);
  });

  it("an order past its own deadline reads as expired, but stays synced until the backend says how it ended", async () => {
    await insertOrder("0xlapsed", { expires_at: "2026-09-01T00:00:00Z" });
    const views = await listLimitOrders(userId, { fetchRecord: async () => response(), now: new Date("2026-09-28T00:00:00Z") });
    const view = views.find((entry) => entry.intentTx === "0xlapsed");
    expect(view).toMatchObject({ status: "expired" });
    expect(view?.justClosed).toBeUndefined();
    const stored = (await sql.query(`select status from limit_orders where intent_tx = '0xlapsed'`)) as { status: string }[];
    expect(stored[0].status).toBe("resting");
    // The late fill the backend then reports still lands as a fill, announced once.
    const filled = response({ open: false, events: [{ eventType: "intent-filled", txHash: "0xlate", intentState: { remainingInput: "0", receivedOutput: "1" } }] });
    const later = await listLimitOrders(userId, { fetchRecord: async () => filled, onFilled: async () => true });
    expect(later.find((entry) => entry.intentTx === "0xlapsed")).toMatchObject({ status: "filled", justClosed: true });
  });

  it("a cancel the person asked for reads as cancelled, even after the deadline", async () => {
    await insertOrder("0xmine", { expires_at: "2026-09-01T00:00:00Z" });
    expect(await markCancelAsked(userId, "0xMINE", "nope")).toBe(false);
    expect(await markCancelAsked(userId, "0xMINE", `0x${"ab".repeat(32)}`)).toBe(true);
    const cancelled = response({ open: false, intent: { ...response().intent, deadline: String(Date.parse("2026-09-01T00:00:00Z") / 1000) }, events: [{ eventType: "intent-cancelled", txHash: "0xc" }] });
    const views = await listLimitOrders(userId, { fetchRecord: async () => cancelled, now: new Date("2026-09-28T00:00:00Z") });
    expect(views.find((view) => view.intentTx === "0xmine")).toMatchObject({ status: "cancelled", cancelAsked: true });
    expect(await markCancelAsked(userId, "0xnobody", `0x${"ab".repeat(32)}`)).toBe(false);
  });

  it("the evening pass checks what is still waiting", async () => {
    await insertOrder("0xstill");
    const summary = await syncWaitingOrders({ now: new Date("2026-09-28T00:00:00Z") });
    expect(summary.checked).toBe(1);
  });
});

describe("judging a placed intent", () => {
  const owners = new Set(["0xeoa", "0xhub"]);
  const now = 1_790_000_000;
  const intent = { inputToken: "0xusdc", outputToken: NVDA, srcAddress: "0xeoa", creator: "0xHUB", deadline: 0n };

  it("accepts a waiting buy of a listing the account made", () => {
    expect(judgeLimitIntent({ intent, direction: "buy", owners, nowSeconds: now })).toMatchObject({ ok: true });
    expect(judgeLimitIntent({ intent: { ...intent, deadline: BigInt(now + 86_400) }, direction: "buy", owners, nowSeconds: now }).ok).toBe(true);
  });

  it("accepts a hub wallet sell, whose source is the hub wallet itself", () => {
    const sell = { inputToken: NVDA, outputToken: "0xusdc", srcAddress: "0xhub", creator: "0xhub", deadline: 0n };
    expect(judgeLimitIntent({ intent: sell, direction: "sell", owners, nowSeconds: now, homeHub: "0xHUB" }).ok).toBe(true);
    // A sell from any hub wallet but the home's is refused, as is one judged without knowing the home.
    expect(judgeLimitIntent({ intent: sell, direction: "sell", owners, nowSeconds: now, homeHub: "0xother" })).toEqual({ ok: false, reason: "not yours" });
    expect(judgeLimitIntent({ intent: sell, direction: "sell", owners, nowSeconds: now })).toEqual({ ok: false, reason: "not yours" });
  });

  it("refuses a market order, someone else's intent, and a pair with no listing", () => {
    expect(judgeLimitIntent({ intent: { ...intent, deadline: BigInt(now + 60) }, direction: "buy", owners, nowSeconds: now })).toEqual({ ok: false, reason: "not a limit order" });
    expect(judgeLimitIntent({ intent: { ...intent, srcAddress: "0xother", creator: "0xother" }, direction: "buy", owners, nowSeconds: now })).toEqual({ ok: false, reason: "not yours" });
    expect(judgeLimitIntent({ intent, direction: "sell", owners, nowSeconds: now })).toEqual({ ok: false, reason: "not a listing" });
  });

  it("keeps the typed price when the intent agrees with it, else the intent's own", () => {
    expect(keptPrice(200, 199.4)).toBe(200);
    expect(keptPrice(200, 150)).toBe(150);
    expect(keptPrice(undefined, 199.123456789)).toBe(199.12346);
  });
});

describe("the switch", () => {
  it("reads LIMIT_ORDERS_USERS on every call", () => {
    vi.stubEnv("LIMIT_ORDERS_USERS", "0xBE59d5bf40ac4a349bd748e0d7c19ef27ad3ca23");
    expect(limitOrdersOn(["u1", "0xbe59d5bf40ac4a349bd748e0d7c19ef27ad3ca23"])).toBe(true);
    expect(limitOrdersOn(["u2", "0x0000000000000000000000000000000000000001"])).toBe(false);
    vi.stubEnv("LIMIT_ORDERS_USERS", "");
    expect(limitOrdersOn(["u1", "0xbe59d5bf40ac4a349bd748e0d7c19ef27ad3ca23"])).toBe(false);
    vi.unstubAllEnvs();
  });
});

// The shared ownership proof is lib/server/pour-ownership's (tested there);
// here every intent passes it, so the sweep's own rules are what is tested.
const owns = async () => true;

describe("the sweep", () => {
  it("records a waiting intent of the account's that Berth has no row for, once, and ignores the rest", async () => {
    const { sweepMissing } = await import("./limit-orders");
    const usdc = "0x29219dd400f2bf60e5a23d13be72b486d4038894";
    const item = (txHash: string, over: Record<string, unknown> = {}) =>
      ({
        ...response(),
        txHash,
        intent: { ...response().intent, inputToken: usdc, creator: "0xhub", srcAddress: "0xhub", ...over },
      }) as IntentResponse;
    const intents = [
      item("0xswept"),
      item("0xmarket", { deadline: String(Math.floor(Date.now() / 1000) + 300) }),
      item("0xstranger", { creator: "0xother", srcAddress: "0xother" }),
      { ...item("0xclosed"), open: false } as IntentResponse,
    ];
    const owners = new Set(["0xhub"]);
    const fetchIntents = async () => intents;
    const first = await sweepMissing(userId, owners, { force: true, fetchIntents, owns });
    expect(first).toBe(1);
    const rows = (await sql.query(`select intent_tx, direction, listing_symbol, src_chain from limit_orders where intent_tx like '0xswept'`)) as {
      intent_tx: string;
      direction: string;
      listing_symbol: string;
      src_chain: string | null;
    }[];
    expect(rows).toEqual([{ intent_tx: "0xswept", direction: "buy", listing_symbol: "NVDA", src_chain: expect.any(String) }]);
    // Forced, but inside two minutes: not swept again, even with a new intent.
    intents.push(item("0xlater"));
    expect(await sweepMissing(userId, owners, { force: true, fetchIntents, owns })).toBe(0);
    // Two minutes on, a forced sweep runs; an unforced one still waits for five.
    const later = new Date(Date.now() + 2 * 60_000 + 1_000);
    expect(await sweepMissing(userId, owners, { now: later, fetchIntents, owns })).toBe(0);
    expect(await sweepMissing(userId, owners, { now: later, force: true, fetchIntents, owns })).toBe(1);
    // Neither was found for a caller where Berth is not available: no mark.
    const { isNoXp } = await import("./no-xp");
    expect(await isNoXp("0xswept")).toBe(false);
  });

  it("marks a limit buy it finds for a caller where Berth is not available, and only a proven one", async () => {
    const { sweepMissing } = await import("./limit-orders");
    const { isNoXp } = await import("./no-xp");
    const usdc = "0x29219dd400f2bf60e5a23d13be72b486d4038894";
    const item = (txHash: string, over: Record<string, unknown> = {}) =>
      ({ ...response(), txHash, intent: { ...response().intent, inputToken: usdc, creator: "0xhub2", srcAddress: "0xhub2", ...over } }) as IntentResponse;
    const intents = [item("0xawaysweep"), item("0xnotmine", { creator: "0xother", srcAddress: "0xother" })];
    const other = (await sql.query(`insert into users (wallet_address) values ('0xsweeper') returning id`)) as { id: string }[];
    expect(await sweepMissing(other[0].id, new Set(["0xhub2"]), { force: true, fetchIntents: async () => intents, noXpBuys: true, owns })).toBe(1);
    expect(await isNoXp("0xawaysweep")).toBe(true);
    expect(await isNoXp("0xnotmine")).toBe(false);
  });
});

describe("the shared ownership proof", () => {
  it("is asked for every intent the sweep would record, and a refusal records nothing", async () => {
    const { sweepMissing } = await import("./limit-orders");
    const usdc = "0x29219dd400f2bf60e5a23d13be72b486d4038894";
    const intents = [{ ...response(), txHash: "0xunproven", intent: { ...response().intent, inputToken: usdc, creator: "0xhub3", srcAddress: "0xhub3" } } as IntentResponse];
    const other = (await sql.query(`insert into users (wallet_address) values ('0xprover') returning id`)) as { id: string }[];
    const refuse = vi.fn(async () => false);
    expect(await sweepMissing(other[0].id, new Set(["0xhub3"]), { force: true, fetchIntents: async () => intents, owns: refuse })).toBe(0);
    expect(refuse).toHaveBeenCalledWith("0xunproven", expect.objectContaining({ creator: "0xhub3" }), "buy");
    expect(((await sql.query(`select 1 from limit_orders where intent_tx = '0xunproven'`)) as unknown[]).length).toBe(0);
  });
});

describe("a proof whose read failed", () => {
  it("defers: the sweep records nothing and saves nothing, and the next sweep, with the read answering, records it", async () => {
    const { sweepMissing } = await import("./limit-orders");
    const usdc = "0x29219dd400f2bf60e5a23d13be72b486d4038894";
    const intents = [{ ...response(), txHash: "0xdeferred", intent: { ...response().intent, inputToken: usdc, creator: "0xhub4", srcAddress: "0xhub4" } } as IntentResponse];
    const other = (await sql.query(`insert into users (wallet_address) values ('0xdeferrer') returning id`)) as { id: string }[];
    const fetchIntents = async () => intents;
    expect(await sweepMissing(other[0].id, new Set(["0xhub4"]), { force: true, fetchIntents, owns: async () => "unknown" as const })).toBe(0);
    expect(((await sql.query(`select 1 from limit_orders where intent_tx = '0xdeferred'`)) as unknown[]).length).toBe(0);
    const later = new Date(Date.now() + 10 * 60_000);
    expect(await sweepMissing(other[0].id, new Set(["0xhub4"]), { now: later, fetchIntents, owns: async () => true })).toBe(1);
  });
});

describe("a fill whose record failed", () => {
  it("is tried again by the next sync until it lands", async () => {
    await insertOrder("0xretry");
    const filled = response({ open: false, events: [{ eventType: "intent-filled", txHash: "0xf2", intentState: { remainingInput: "0", receivedOutput: "1" } }] });
    const calls = (mock: { mock: { calls: unknown[][] } }) =>
      mock.mock.calls.filter((call) => (call[0] as { intent_tx: string }).intent_tx === "0xretry").length;
    const failing = vi.fn<(row: { intent_tx: string }) => Promise<boolean>>(async () => false);
    await listLimitOrders(userId, { fetchRecord: async () => filled, onFilled: failing });
    expect(calls(failing)).toBe(1);
    const working = vi.fn<(row: { intent_tx: string }) => Promise<boolean>>(async () => true);
    await listLimitOrders(userId, { fetchRecord: async () => filled, onFilled: working });
    expect(calls(working)).toBe(1);
    const again = vi.fn<(row: { intent_tx: string }) => Promise<boolean>>(async () => true);
    await listLimitOrders(userId, { fetchRecord: async () => filled, onFilled: again });
    expect(calls(again)).toBe(0);
    const stored = (await sql.query(`select fill_recorded_at from limit_orders where intent_tx = '0xretry'`)) as { fill_recorded_at: unknown }[];
    expect(stored[0].fill_recorded_at).not.toBeNull();
  });
});

describe("the chain an intent came from", () => {
  it("is the home chain for a sell the hub wallet made on Sonic, else the relay's own", async () => {
    const { sourceChainOf } = await import("./limit-orders");
    const { ChainKeys, getIntentRelayChainId } = await import("@sodax/sdk");
    const { HOME_CHAIN } = await import("@/lib/account");
    expect(sourceChainOf(getIntentRelayChainId(ChainKeys.SONIC_MAINNET))).toBe(HOME_CHAIN);
    expect(sourceChainOf(getIntentRelayChainId(ChainKeys.ARBITRUM_MAINNET))).toBe(ChainKeys.ARBITRUM_MAINNET);
    expect(sourceChainOf(987654321n)).toBeUndefined();
  });

  it("a dated order two minutes out is still a limit order when placed as one, but not to the sweep", () => {
    const owners = new Set(["0xhub"]);
    const nowSeconds = 1_790_000_000;
    const intent = { inputToken: "0xusdc", outputToken: NVDA, srcAddress: "0xhub", creator: "0xhub", deadline: BigInt(nowSeconds + 150) };
    expect(judgeLimitIntent({ intent, direction: "buy", owners, nowSeconds }).ok).toBe(true);
    expect(judgeLimitIntent({ intent, direction: "buy", owners, nowSeconds, minWaitSeconds: 4 * 3600 }).ok).toBe(false);
  });
});
