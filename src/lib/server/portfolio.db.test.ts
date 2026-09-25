import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setSqlClient, type SqlClient } from "./db";
import { makeTestDb } from "./pglite-test-db";
import { getOrCreateUser } from "./accounts";
import { readMarks, writeMarks } from "./marks";
import { runEvening } from "./evening";
import { fillOrderMarks, loadOrderFacts, ordersMissingMarks } from "./order-marks";
import { recordOrderMarks } from "./orders";
import {
  loadPortfolioDays,
  runPortfolioSnapshot,
  savePortfolioDay,
  snapshotAccounts,
  snapshotPrice,
} from "./portfolio";

/**
 * The stored marks and portfolio days against a real Postgres with the
 * real schema: the despike's delete, the snapshot that outranks a ledger
 * row, and a snapshot run that tolerates one account failing.
 */

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

beforeEach(async () => {
  await sql.query("delete from order_marks");
  await sql.query("delete from orders");
  await sql.query("delete from portfolio_days");
  await sql.query("delete from marks");
  await sql.query("delete from users");
});

const wallet = (n: number) => `0x${String(n).padStart(40, "0")}`;
const account = async (n: number) => (await getOrCreateUser({ did: null, wallet: wallet(n) }))!.user;
const FRIDAY_EVENING = new Date("2026-09-25T23:05:00Z");
let intents = 0;
const placeOrder = async (userId: string, placedAt = "2026-09-24T15:00:00Z", usd = 100) => {
  intents += 1;
  const [row] = (await sql.query(
    `insert into orders (user_id, intent_tx, direction, listing_symbol, listing_address, quantity, usd_value, placed_at)
     values ($1, $2, 'buy', 'NVDA', '0xnvda', 1, $3, $4::timestamptz) returning id`,
    [userId, `0x${String(intents).padStart(64, "0")}`, usd, placedAt],
  )) as { id: string }[];
  return row.id;
};

describe("marks", () => {
  it("upserts, re-reads oldest first, and takes out a rejected day", async () => {
    await writeMarks("SPY", [{ day: "2026-09-23", close: 1 }, { day: "2026-09-24", close: 2 }], []);
    await writeMarks("SPY", [{ day: "2026-09-24", close: 3 }], ["2026-09-23"]);
    expect(await readMarks(["SPY", "BTC"])).toEqual({
      SPY: { dates: ["2026-09-24"], values: [3] },
      BTC: { dates: [], values: [] },
    });
  });
});

describe("portfolio days", () => {
  it("never lets a ledger row replace a snapshot", async () => {
    const user = await account(1);
    const snapshot = { value: 10, holdings: [] };
    await savePortfolioDay(user.id, "2026-09-24", snapshot, "snapshot", "2026-09-24T22:30:00Z");
    expect(
      await savePortfolioDay(user.id, "2026-09-24", { value: 99, holdings: [] }, "ledger", "2026-09-24T21:30:00Z"),
    ).toBe(false);
    const days = await loadPortfolioDays(user.id);
    expect(days).toEqual([
      { day: "2026-09-24", value: 10, holdings: [], source: "snapshot", asOf: "2026-09-24T22:30:00.000Z" },
    ]);
  });

  it("snapshots every account at today's close, the oracle where the close is missing, and survives one failing", async () => {
    const holder = await account(1);
    const broken = await account(2);
    const empty = await account(3);
    // Never ordered and no row: not read at all.
    await account(4);
    for (const user of [holder, broken, empty]) await placeOrder(user.id);
    await writeMarks("NVDA", [{ day: "2026-09-25", close: 200 }], []);

    const summary = await runPortfolioSnapshot({
      now: FRIDAY_EVENING,
      deriveHubWallet: async (spoke) => `hub-${spoke}`,
      readBalances: async (hub): Promise<Record<string, number>> => {
        if (hub === `hub-${wallet(2)}`) throw new Error("rpc down");
        if (hub === `hub-${wallet(3)}`) return {};
        return { NVDA: 2, SGOV: 1 };
      },
      livePrices: async () => ({ SGOV: 100.5 }),
    });

    expect(summary).toMatchObject({ day: "2026-09-25", accounts: 3, written: 1, empty: 1, failed: 1, oraclePriced: 1 });
    const [row] = await loadPortfolioDays(holder.id);
    expect(row.value).toBeCloseTo(500.5, 10);
    expect(row.source).toBe("snapshot");
    expect(row.holdings).toEqual([
      { symbol: "NVDA", quantity: 2, price: 200, source: "mark" },
      { symbol: "SGOV", quantity: 1, price: 100.5, source: "oracle" },
    ]);
    expect(await loadPortfolioDays(broken.id)).toEqual([]);
    expect(await loadPortfolioDays(empty.id)).toEqual([]);
  });

  it("values a close out of line with the oracle at the oracle, a bad print never stored", async () => {
    const user = await account(1);
    await placeOrder(user.id);
    await writeMarks("NVDA", [{ day: "2026-09-25", close: 500 }], []);
    await writeMarks("AAPL", [{ day: "2026-09-25", close: 102 }], []);
    const summary = await runPortfolioSnapshot({
      now: FRIDAY_EVENING,
      deriveHubWallet: async (spoke) => spoke,
      readBalances: async () => ({ NVDA: 1, AAPL: 1 }),
      livePrices: async () => ({ NVDA: 101, AAPL: 100 }),
    });
    expect(summary.oraclePriced).toBe(1);
    const [row] = await loadPortfolioDays(user.id);
    // AAPL's close is within five percent of the oracle and stands.
    expect(row.holdings).toEqual([
      { symbol: "AAPL", quantity: 1, price: 102, source: "mark" },
      { symbol: "NVDA", quantity: 1, price: 101, source: "oracle" },
    ]);
    expect(row.value).toBeCloseTo(203, 10);
  });

  it("chooses the close or the oracle by how far apart they stand", () => {
    expect(snapshotPrice(100, 104)).toEqual({ price: 100, source: "mark" });
    expect(snapshotPrice(100, 106)).toEqual({ price: 106, source: "oracle" });
    expect(snapshotPrice(undefined, 106)).toEqual({ price: 106, source: "oracle" });
    expect(snapshotPrice(100, undefined)).toEqual({ price: 100, source: "mark" });
    expect(snapshotPrice(undefined, undefined)).toBeUndefined();
  });

  it("counts an account that takes too long as failed, writes nothing for it, and moves on", async () => {
    const slow = await account(1);
    const quick = await account(2);
    await placeOrder(slow.id);
    await placeOrder(quick.id);
    const summary = await runPortfolioSnapshot({
      now: FRIDAY_EVENING,
      accountTimeoutMs: 50,
      deriveHubWallet: async (spoke) => spoke,
      readBalances: async (hub): Promise<Record<string, number>> => {
        if (hub === wallet(1)) await new Promise((resolve) => setTimeout(resolve, 200));
        return { SGOV: 1 };
      },
      livePrices: async () => ({ SGOV: 100 }),
    });
    expect(summary).toMatchObject({ accounts: 2, written: 1, failed: 1 });
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(await loadPortfolioDays(slow.id)).toEqual([]);
    expect(await loadPortfolioDays(quick.id)).toHaveLength(1);
  });

  it("reads only accounts with an order or a row", async () => {
    const ordered = await account(1);
    const remembered = await account(2);
    await account(3);
    await placeOrder(ordered.id);
    await savePortfolioDay(remembered.id, "2026-09-24", { value: 1, holdings: [] }, "snapshot", "2026-09-24T22:30:00Z");
    expect((await snapshotAccounts()).map((entry) => entry.id).sort()).toEqual([ordered.id, remembered.id].sort());
  });

  it("re-values a stored day when its mark changes or is taken out, keeping as_of", async () => {
    const user = await account(1);
    await writeMarks("NVDA", [{ day: "2026-09-23", close: 100 }, { day: "2026-09-24", close: 500 }, { day: "2026-09-25", close: 500 }], []);
    const spiked = {
      value: 1000 + 100,
      holdings: [
        { symbol: "NVDA", quantity: 2, price: 500, source: "mark" as const },
        { symbol: "SGOV", quantity: 1, price: 100, source: "oracle" as const },
      ],
    };
    await savePortfolioDay(user.id, "2026-09-24", spiked, "snapshot", "2026-09-24T23:05:00Z");
    await savePortfolioDay(user.id, "2026-09-25", spiked, "snapshot", "2026-09-25T23:05:00Z");

    // Thursday's print is corrected to 101; Friday's is taken out by the despike.
    expect(await writeMarks("NVDA", [{ day: "2026-09-24", close: 101 }], ["2026-09-25"])).toBe(2);
    const [thursday, friday] = await loadPortfolioDays(user.id);
    expect(thursday.value).toBeCloseTo(302, 10);
    expect(thursday.holdings[0]).toEqual({ symbol: "NVDA", quantity: 2, price: 101, source: "mark" });
    expect(thursday.asOf).toBe("2026-09-24T23:05:00.000Z");
    // Friday takes Thursday's close, and says so; the oracle price stands.
    expect(friday.value).toBeCloseTo(302, 10);
    expect(friday.holdings).toEqual([
      { symbol: "NVDA", quantity: 2, price: 101, source: "prior_mark" },
      { symbol: "SGOV", quantity: 1, price: 100, source: "oracle" },
    ]);
    expect(friday.asOf).toBe("2026-09-25T23:05:00.000Z");
    expect(friday.source).toBe("snapshot");
    // Written again unchanged: nothing to put right.
    expect(await writeMarks("NVDA", [{ day: "2026-09-24", close: 101 }], [])).toBe(0);
  });

  it("writes a sold out account's zero once it has history, and nothing on a weekend", async () => {
    const user = await account(1);
    await savePortfolioDay(user.id, "2026-09-24", { value: 10, holdings: [] }, "snapshot", "2026-09-24T22:30:00Z");
    const deps = {
      deriveHubWallet: async (spoke: string) => spoke,
      readBalances: async () => ({}),
      livePrices: async () => ({}),
    };
    expect((await runPortfolioSnapshot({ now: FRIDAY_EVENING, ...deps })).written).toBe(1);
    expect((await loadPortfolioDays(user.id)).map((day) => day.value)).toEqual([10, 0]);
    const saturday = await runPortfolioSnapshot({ now: new Date("2026-09-26T23:05:00Z"), ...deps });
    expect(saturday.skipped).toBeTruthy();
  });
});

describe("order marks", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Every benchmark has closes from before the orders, so each could be priced.
  beforeEach(async () => {
    for (const symbol of ["SPY", "QQQ", "PAXG", "BTC", "SGOV"]) {
      await writeMarks(symbol, [{ day: "2026-07-08", close: 1 }], []);
    }
  });

  const llama = (prices: Record<string, number>) =>
    vi.fn(async (url: string) => {
      const coins: Record<string, { price: number; timestamp: number }> = {};
      for (const [id, price] of Object.entries(prices)) {
        if (url.includes(`coingecko:${id}`)) coins[`coingecko:${id}`] = { price, timestamp: 1790340000 };
      }
      return new Response(JSON.stringify({ coins }));
    });

  it("records every benchmark at the order's minute in one request, keeps what is stored, and hands them to the order", async () => {
    const user = await account(1);
    const id = await placeOrder(user.id, "2026-09-24T15:00:00Z");
    const fetchMock = llama({
      "spdr-s-p-500-etf-trust-robinhood-tokenized-stock": 700,
      "invesco-qqq-robinhood-tokenized-stock": 600,
      "pax-gold": 4000,
      bitcoin: 90000,
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await recordOrderMarks(id, new Date("2026-09-24T15:00:00Z"))).toBe(4);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain(`/prices/historical/${Date.parse("2026-09-24T15:00:00Z") / 1000}/`);

    // SGOV was missing: the order is still short, and the mend fills only that.
    expect((await ordersMissingMarks(10)).map((order) => order.id)).toEqual([id]);
    vi.stubGlobal("fetch", llama({ "spdr-s-p-500-etf-trust-robinhood-tokenized-stock": 1, "ishares-0-3-month-treasury-bond-etf-robinhood-tokenized-stock": 100 }));
    expect(await fillOrderMarks()).toEqual({ orders: 1, written: 1, failed: 0 });
    expect(await ordersMissingMarks(10)).toEqual([]);

    const [facts] = await loadOrderFacts(user.id);
    expect(facts.benchmarkMarks).toEqual({ SPY: 700, QQQ: 600, PAXG: 4000, BTC: 90000, SGOV: 100 });
  });

  it("never throws when DefiLlama is down, and leaves an order without marks unmarked", async () => {
    const user = await account(1);
    const id = await placeOrder(user.id);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 502 })));
    expect(await recordOrderMarks(id, new Date("2026-09-24T15:00:00Z"))).toBe(0);
    const [facts] = await loadOrderFacts(user.id);
    expect(facts.benchmarkMarks).toBeUndefined();
    expect(await fillOrderMarks()).toEqual({ orders: 1, written: 0, failed: 1 });
  });
});

describe("the order marks queue", () => {
  it("takes the newest first, and skips a benchmark that had no mark yet on the order's day", async () => {
    const user = await account(1);
    await writeMarks("SPY", [{ day: "2026-07-01", close: 1 }], []);
    await writeMarks("SGOV", [{ day: "2026-07-08", close: 1 }], []);
    const early = await placeOrder(user.id, "2026-07-02T15:00:00Z");
    const later = await placeOrder(user.id, "2026-08-02T15:00:00Z");
    expect((await ordersMissingMarks(10)).map((order) => order.id)).toEqual([later, early]);
    // Once SPY is priced, the July 2 order only lacks SGOV, which did not exist yet: out of the queue.
    await sql.query(`insert into order_marks (order_id, symbol, price) values ($1, 'SPY', 1)`, [early]);
    expect((await ordersMissingMarks(10)).map((order) => order.id)).toEqual([later]);
  });
});

describe("the evening run", () => {
  const marksOk = { symbols: 15, written: 105, dropped: 0, revalued: 0, empty: [], failures: [] };
  const ordersOk = { orders: 0, written: 0, failed: 0 };
  const snapshotOk = { day: "2026-09-25", accounts: 1, written: 1, empty: 0, oraclePriced: 0, failed: 0, unreached: 0 };

  it("runs every stage in order, each whatever the one before did", async () => {
    const order: string[] = [];
    const summary = await runEvening({
      marks: async () => {
        order.push("marks");
        throw new Error("DefiLlama down");
      },
      orderMarks: async () => {
        order.push("orderMarks");
        return ordersOk;
      },
      snapshot: async () => {
        order.push("snapshot");
        return snapshotOk;
      },
    });
    expect(order).toEqual(["marks", "orderMarks", "snapshot"]);
    expect(summary.marks).toEqual({ ok: false, error: "DefiLlama down" });
    expect(summary).toMatchObject({ written: 1, failed: true });
  });

  it("gives a stage that runs past its budget up and goes on", async () => {
    const summary = await runEvening({
      marks: () => new Promise(() => {}),
      orderMarks: async () => ordersOk,
      snapshot: async () => snapshotOk,
      budgets: { marks: 30, orderMarks: 30, snapshotDeadline: 100 },
    });
    expect(summary.marks.ok).toBe(false);
    expect(summary.snapshot).toEqual({ ok: true, result: snapshotOk });
  });

  it("counts nothing written with a failure as failed, and a quiet weekend as fine", async () => {
    const failing = await runEvening({
      marks: async () => ({ ...marksOk, written: 0, failures: ["all: 502"] }),
      orderMarks: async () => ordersOk,
      snapshot: async () => ({ ...snapshotOk, day: null, accounts: 0, written: 0 }),
    });
    expect(failing).toMatchObject({ written: 0, failed: true });
    const quiet = await runEvening({
      marks: async () => ({ ...marksOk, written: 0 }),
      orderMarks: async () => ordersOk,
      snapshot: async () => ({ ...snapshotOk, day: null, accounts: 0, written: 0 }),
    });
    expect(quiet).toMatchObject({ written: 0, failed: false });
  });

  it("starts no account after the snapshot's deadline, and says how many it left", async () => {
    for (let n = 1; n <= 3; n += 1) await placeOrder((await account(n)).id);
    const summary = await runPortfolioSnapshot({
      now: FRIDAY_EVENING,
      deadline: Date.now() - 1,
      deriveHubWallet: async (spoke) => spoke,
      readBalances: async () => ({ SGOV: 1 }),
      livePrices: async () => ({ SGOV: 100 }),
    });
    expect(summary).toMatchObject({ accounts: 3, written: 0, unreached: 3 });
  });
});
