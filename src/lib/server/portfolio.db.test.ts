import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setSqlClient, type SqlClient } from "./db";
import { makeTestDb } from "./pglite-test-db";
import { getOrCreateUser } from "./accounts";
import { readMarks, writeMarks } from "./marks";
import { runEvening } from "./evening";
import { fillOrderMarks, loadOrderFacts, loadOrderLog, ordersMissingMarks } from "./order-marks";
import { recordOrderMarks } from "./orders";
import { robinhoodRpcFake } from "./robinhood-rpc-fake";
import { makeRobinhoodHoldingsReader } from "./robinhood-balances";
import { TOKEN_LISTINGS } from "@/lib/listings";
import {
  hasRobinhoodOrders,
  loadPortfolioDays,
  readAccountBalances,
  combineAccountDays,
  rebuildMergedPortfolios,
  runPortfolioSnapshot,
  savePortfolioDay,
  snapshotAccounts,
  snapshotPrice,
} from "./portfolio";

/** Nothing on Robinhood Chain, read without a network call. */
const nothingOnRobinhood = async (owners: readonly string[]) =>
  new Map(owners.map((owner) => [owner.toLowerCase(), {} as Record<string, number>]));

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
  await sql.query("delete from account_merges");
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
      readRobinhood: nothingOnRobinhood,
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
      readRobinhood: nothingOnRobinhood,
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

  it("values the second shelf like the first: a stored close where there is one, the oracle where not", async () => {
    const user = await account(1);
    await placeOrder(user.id);
    await writeMarks("GOOGL", [{ day: "2026-09-25", close: 344 }], []);
    const summary = await runPortfolioSnapshot({
      readRobinhood: nothingOnRobinhood,
      now: FRIDAY_EVENING,
      deriveHubWallet: async (spoke) => spoke,
      readBalances: async () => ({ GOOGL: 0.5, BABA: 2 }),
      livePrices: async () => ({ GOOGL: 345, BABA: 108.5 }),
    });
    expect(summary).toMatchObject({ written: 1, oraclePriced: 1, failed: 0 });
    const [row] = await loadPortfolioDays(user.id);
    expect(row.holdings).toEqual([
      { symbol: "BABA", quantity: 2, price: 108.5, source: "oracle" },
      { symbol: "GOOGL", quantity: 0.5, price: 344, source: "mark" },
    ]);
    expect(row.value).toBeCloseTo(389, 10);
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
      readRobinhood: nothingOnRobinhood,
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

  it("sums every linked address's hub wallet into one day, and fails whole when one read fails", async () => {
    const user = await account(1);
    await placeOrder(user.id);
    await sql.query(
      `insert into user_identities (user_id, kind, value, family, is_home, verified_at, proof)
       values ($1, 'wallet', $2, 'evm', false, now(), 'siwe')`,
      [user.id, `eip155:${wallet(91)}`],
    );
    const accounts = await snapshotAccounts();
    expect(accounts).toEqual([{ id: user.id, wallet: wallet(1), wallets: [wallet(1), wallet(91)], robinhoodOrders: false }]);
    await writeMarks("NVDA", [{ day: "2026-09-25", close: 200 }], []);
    const summary = await runPortfolioSnapshot({
      readRobinhood: nothingOnRobinhood,
      now: FRIDAY_EVENING,
      accounts,
      deriveHubWallet: async (spoke) => `hub-${spoke}`,
      readBalances: async (hub): Promise<Record<string, number>> => (hub === `hub-${wallet(1)}` ? { NVDA: 2 } : { NVDA: 1, SGOV: 1 }),
      livePrices: async () => ({ NVDA: 200, SGOV: 100 }),
    });
    expect(summary).toMatchObject({ written: 1, failed: 0 });
    const [row] = await loadPortfolioDays(user.id);
    expect(row.value).toBeCloseTo(700, 10);
    expect(row.holdings).toEqual([
      { symbol: "NVDA", quantity: 3, price: 200, source: "mark" },
      { symbol: "SGOV", quantity: 1, price: 100, source: "oracle" },
    ]);

    await expect(
      readAccountBalances([wallet(1), wallet(91)], async (hub) => {
        if (hub === wallet(91)) throw new Error("rpc down");
        return { NVDA: 1 };
      }, async (spoke) => spoke, nothingOnRobinhood),
    ).rejects.toThrow("rpc down");
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
      readRobinhood: nothingOnRobinhood,
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

  // DefiLlama quotes the share; the chain says SPY's token stood for
  // 1.001717991 shares from 2026-09-18 and SGOV's for 1.00510177.
  const llama = (prices: Record<string, number>) =>
    vi.fn(
      robinhoodRpcFake({
        multipliers: { SPY: 1.001717991, SGOV: 1.00510177 },
        changes: { SPY: [{ from: 1, to: 1.001717991, effectiveAt: Date.parse("2026-09-18T00:10:33Z") / 1000 }] },
        genesisSeconds: Date.parse("2026-09-01T00:00:00Z") / 1000,
        latestBlock: 5_000_000,
        otherwise: async (url: string) => {
          const coins: Record<string, { price: number; timestamp: number }> = {};
          for (const [id, price] of Object.entries(prices)) {
            if (url.includes(`coingecko:${id}`)) coins[`coingecko:${id}`] = { price, timestamp: 1790340000 };
          }
          return new Response(JSON.stringify({ coins }));
        },
      }),
    );

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
    const llamaCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("coins.llama.fi"));
    expect(llamaCalls).toHaveLength(1);
    expect(String(llamaCalls[0][0])).toContain(`/prices/historical/${Date.parse("2026-09-24T15:00:00Z") / 1000}/`);

    // SGOV was missing: the order is still short, and the mend fills only that.
    expect((await ordersMissingMarks(10)).map((order) => order.id)).toEqual([id]);
    vi.stubGlobal("fetch", llama({ "spdr-s-p-500-etf-trust-robinhood-tokenized-stock": 1, "ishares-0-3-month-treasury-bond-etf-robinhood-tokenized-stock": 100 }));
    expect(await fillOrderMarks()).toEqual({ orders: 1, written: 1, failed: 0 });
    expect(await ordersMissingMarks(10)).toEqual([]);

    const [facts] = await loadOrderFacts(user.id);
    // The listing benchmarks are the token's worth, the others DefiLlama's price as it is.
    expect(facts.benchmarkMarks).toEqual({
      SPY: expect.closeTo(700 * 1.001717991, 6),
      QQQ: 600,
      PAXG: 4000,
      BTC: 90000,
      SGOV: expect.closeTo(100 * 1.00510177, 6),
    });
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
      readRobinhood: nothingOnRobinhood,
      now: FRIDAY_EVENING,
      deadline: Date.now() - 1,
      deriveHubWallet: async (spoke) => spoke,
      readBalances: async () => ({ SGOV: 1 }),
      livePrices: async () => ({ SGOV: 100 }),
    });
    expect(summary).toMatchObject({ accounts: 3, written: 0, unreached: 3 });
  });
});

describe("the order log an assistant reads", () => {
  it("says which orders filled, newest first, and leaves loadOrderFacts as it was", async () => {
    const user = await account(71);
    const placed = await placeOrder(user.id, "2026-09-20T15:00:00Z");
    const filled = await placeOrder(user.id, "2026-09-21T15:00:00Z");
    await sql.query(`update orders set fill_tx = '0xfill', filled_at = '2026-09-21T15:01:00Z' where id = $1`, [filled]);
    const log = await loadOrderLog(user.id, 10);
    expect(log.total).toBe(2);
    expect(log.entries.map((entry) => entry.filled)).toEqual([true, false]);
    expect(log.entries[1].at).toBe("2026-09-20T15:00:00.000Z");
    expect((await loadOrderLog(user.id, 1)).entries).toHaveLength(1);
    expect(await loadOrderFacts(user.id)).toHaveLength(2);
    expect(placed).toBeTruthy();
  });
});

describe("a merged account's history, redrawn", () => {
  const flag = (id: string) => sql.query(`update users set portfolio_rebuild_at = now() where id = $1`, [id]);
  const flagOf = async (id: string) =>
    ((await sql.query(`select portfolio_rebuild_at from users where id = $1`, [id])) as { portfolio_rebuild_at: string | null }[])[0]
      .portfolio_rebuild_at;

  it("from the joined orders when they explain what the account holds, then clears the flag", async () => {
    const user = await account(81);
    await placeOrder(user.id, "2026-09-23T15:00:00Z");
    await writeMarks("NVDA", [{ day: "2026-09-23", close: 100 }, { day: "2026-09-24", close: 110 }], []);
    await flag(user.id);
    const summary = await rebuildMergedPortfolios({
      readRobinhood: nothingOnRobinhood,
      now: new Date("2026-09-24T23:00:00Z"),
      deriveHubWallet: async (spoke) => spoke,
      readBalances: async () => ({ NVDA: 1 }),
    });
    expect(summary).toMatchObject({ accounts: 1, rebuilt: 1, written: 2 });
    expect((await loadPortfolioDays(user.id)).map((d) => [d.day, d.value, d.source])).toEqual([
      ["2026-09-23", 100, "ledger"],
      ["2026-09-24", 110, "ledger"],
    ]);
    expect(await flagOf(user.id)).toBeNull();
  });

  it("writes nothing when the orders do not explain the holdings, and waits a day when the chain cannot be read", async () => {
    const user = await account(82);
    await placeOrder(user.id, "2026-09-23T15:00:00Z");
    await flag(user.id);
    const failed = await rebuildMergedPortfolios({
      readRobinhood: nothingOnRobinhood,
      deriveHubWallet: async (spoke) => spoke,
      readBalances: async () => {
        throw new Error("rpc down");
      },
    });
    expect(failed).toMatchObject({ accounts: 1, failed: 1 });
    expect(await flagOf(user.id)).not.toBeNull();
    const unexplained = await rebuildMergedPortfolios({
      readRobinhood: nothingOnRobinhood,
      deriveHubWallet: async (spoke) => spoke,
      readBalances: async () => ({ NVDA: 5 }),
    });
    expect(unexplained).toMatchObject({ accounts: 1, unexplained: 1, written: 0 });
    expect(await loadPortfolioDays(user.id)).toEqual([]);
    expect(await flagOf(user.id)).toBeNull();
  });
});

describe("a merged account's history, read", () => {
  const row = (day: string, value: number, createdAt: string, source: "snapshot" | "ledger" = "snapshot") => ({
    day,
    value,
    holdings: [{ symbol: "NVDA", quantity: value / 100, price: 100, source: "mark" as const }],
    source,
    asOf: `${day}T21:30:00.000Z`,
    createdAt,
  });

  it("adds the retired account's days, carries a missing day forward, and stops once the survivor's rows read every wallet", () => {
    const merged = combineAccountDays(
      {
        rows: [
          row("2026-09-01", 100, "2026-09-01T22:00:00Z"),
          row("2026-09-03", 110, "2026-09-03T22:00:00Z"),
          // Written after the merge: it reads both accounts' wallets.
          row("2026-09-05", 400, "2026-09-05T22:00:00Z"),
        ],
      },
      [{ rows: [row("2026-09-02", 200, "2026-09-02T22:00:00Z"), row("2026-09-04", 250, "2026-09-04T22:00:00Z")], retiredAt: "2026-09-05T12:00:00Z" }],
    );
    expect(merged.map((day) => [day.day, day.value, day.source])).toEqual([
      ["2026-09-01", 100, "snapshot"],
      ["2026-09-02", 300, "ledger"],
      ["2026-09-03", 310, "ledger"],
      ["2026-09-04", 360, "ledger"],
      ["2026-09-05", 400, "snapshot"],
    ]);
    expect(merged[3].holdings).toEqual([{ symbol: "NVDA", quantity: 3.6, price: 100, source: "mark" }]);
  });

  it("a chain of merges counts each wallet once: C joined A, then A joined S", () => {
    // C (10) joined A on 09-10; A's rows after that read C's wallets too (30).
    // A joined S on 09-12; S's rows are its own (100).
    const merged = combineAccountDays({ id: "S", rows: [row("2026-09-09", 100, "2026-09-09T22:00:00Z"), row("2026-09-15", 100, "2026-09-11T22:00:00Z")] }, [
      { id: "A", parent: "S", retiredAt: "2026-09-12T12:00:00Z", rows: [row("2026-09-09", 20, "2026-09-09T22:00:00Z"), row("2026-09-15", 30, "2026-09-11T22:00:00Z")] },
      { id: "C", parent: "A", retiredAt: "2026-09-10T12:00:00Z", rows: [row("2026-09-09", 10, "2026-09-09T22:00:00Z")] },
    ]);
    expect(merged.map((day) => [day.day, day.value])).toEqual([
      ["2026-09-09", 130],
      ["2026-09-15", 130],
    ]);
    // Once S has a row written after A joined, neither A nor C adds anything.
    const later = combineAccountDays({ id: "S", rows: [row("2026-09-16", 140, "2026-09-16T22:00:00Z")] }, [
      { id: "A", parent: "S", retiredAt: "2026-09-12T12:00:00Z", rows: [row("2026-09-15", 30, "2026-09-11T22:00:00Z")] },
      { id: "C", parent: "A", retiredAt: "2026-09-10T12:00:00Z", rows: [row("2026-09-09", 10, "2026-09-09T22:00:00Z")] },
    ]);
    expect(later.map((day) => [day.day, day.value])).toEqual([
      ["2026-09-09", 10],
      ["2026-09-15", 30],
      ["2026-09-16", 140],
    ]);
  });

  it("an account nobody merged into reads its own rows unchanged", () => {
    const own = [row("2026-09-01", 100, "2026-09-01T22:00:00Z")];
    expect(combineAccountDays({ rows: own }, [])).toEqual([
      { day: "2026-09-01", value: 100, holdings: own[0].holdings, source: "snapshot", asOf: own[0].asOf },
    ]);
  });

  it("reads a chain of merges from the database once per wallet (S=100, A with C=30, C=10)", async () => {
    const { mergeAccounts } = await import("./account-merge");
    const [s, a, c] = [await account(93), await account(94), await account(95)];
    await sql.query(`update users set email = 'chain@example.com' where id = $1`, [s.id]);
    expect((await mergeAccounts({ survivor: a.id, absorbed: c.id, reason: "wallet" })).ok).toBe(true);
    expect((await mergeAccounts({ survivor: s.id, absorbed: a.id, reason: "email" })).ok).toBe(true);
    await sql.query(`update users set retired_at = '2026-09-10T12:00:00Z' where id = $1`, [c.id]);
    await sql.query(`update users set retired_at = '2026-09-12T12:00:00Z' where id = $1`, [a.id]);
    const put = (id: string, day: string, value: number, createdAt: string) =>
      sql.query(
        `insert into portfolio_days (user_id, day, value_usd, source, as_of, created_at) values ($1, $2::date, $3, 'snapshot', $2::timestamptz, $4::timestamptz)`,
        [id, day, value, createdAt],
      );
    await put(s.id, "2026-09-09", 100, "2026-09-09T22:00:00Z");
    await put(s.id, "2026-09-15", 100, "2026-09-11T22:00:00Z");
    await put(a.id, "2026-09-09", 20, "2026-09-09T22:00:00Z");
    await put(a.id, "2026-09-15", 30, "2026-09-11T22:00:00Z");
    await put(c.id, "2026-09-09", 10, "2026-09-09T22:00:00Z");
    expect((await loadPortfolioDays(s.id)).map((day) => [day.day, day.value])).toEqual([
      ["2026-09-09", 130],
      ["2026-09-15", 130],
    ]);
  });

  it("keeps every stored day of both accounts when the orders do not explain the holdings", async () => {
    const { mergeAccounts } = await import("./account-merge");
    const survivor = await account(91);
    const absorbed = await account(92);
    await sql.query(`update users set email = 'keep@example.com' where id = $1`, [survivor.id]);
    await placeOrder(absorbed.id, "2026-09-22T15:00:00Z");
    await savePortfolioDay(survivor.id, "2026-09-22", { value: 100, holdings: [] }, "snapshot", "2026-09-22T22:30:00Z");
    await savePortfolioDay(absorbed.id, "2026-09-22", { value: 50, holdings: [] }, "snapshot", "2026-09-22T22:30:00Z");
    await savePortfolioDay(absorbed.id, "2026-09-23", { value: 60, holdings: [] }, "snapshot", "2026-09-23T22:30:00Z");
    expect((await mergeAccounts({ survivor: survivor.id, absorbed: absorbed.id, reason: "email" })).ok).toBe(true);
    // Both stamps come from now(), and PGlite's clock can give the saves and
    // the merge the same instant, which reads as a row written after the
    // merge. Pin them: every row written the evening of its day, the merge
    // the day after the last.
    await sql.query(`update portfolio_days set created_at = day + interval '22 hours 30 minutes'`);
    await sql.query(`update users set retired_at = '2026-09-24T12:00:00Z' where id = $1`, [absorbed.id]);
    const summary = await rebuildMergedPortfolios({ readRobinhood: nothingOnRobinhood, deriveHubWallet: async (spoke) => spoke, readBalances: async () => ({ NVDA: 7 }) });
    expect(summary).toMatchObject({ unexplained: 1, written: 0 });
    expect(((await sql.query(`select count(*)::int as n from portfolio_days`)) as { n: number }[])[0].n).toBe(3);
    expect((await loadPortfolioDays(survivor.id)).map((day) => [day.day, day.value])).toEqual([
      ["2026-09-22", 150],
      ["2026-09-23", 160],
    ]);
  });
});

describe("Robinhood Chain in the portfolio", () => {
  const onRobinhood = (byOwner: Record<string, Record<string, number>>, asked: string[][] = []) =>
    async (owners: readonly string[]) => {
      asked.push([...owners]);
      return new Map(
        owners.flatMap((owner) => {
          const holdings = byOwner[owner.toLowerCase()];
          return holdings ? [[owner.toLowerCase(), holdings] as const] : [];
        }),
      );
    };
  const deliveredThere = (orderId: string) =>
    sql.query(`update orders set holding_chain = 'robinhood' where id = $1`, [orderId]);

  it("adds what the account's wallets hold on Robinhood Chain to the hub, every wallet asked in one request for the whole run", async () => {
    const holder = await account(1);
    const other = await account(2);
    await deliveredThere(await placeOrder(holder.id));
    await placeOrder(other.id);
    await writeMarks("NVDA", [{ day: "2026-09-25", close: 200 }], []);
    // The live reader's shape: remembered per wallet, over a chain read that counts its requests.
    const nvda = TOKEN_LISTINGS.find((listing) => listing.symbol === "NVDA")!;
    const requests: number[] = [];
    const readRobinhood = makeRobinhoodHoldingsReader(async (queries) => {
      requests.push(queries.length);
      return queries.map((query) =>
        query.holder === wallet(1) && query.token.toLowerCase() === nvda.rhAddress!.toLowerCase() ? 15n * 10n ** 17n : 0n,
      );
    });
    const summary = await runPortfolioSnapshot({
      now: FRIDAY_EVENING,
      readRobinhood,
      deriveHubWallet: async (spoke) => `hub-${spoke}`,
      readBalances: async (hub): Promise<Record<string, number>> => (hub === `hub-${wallet(1)}` ? { NVDA: 1 } : { NVDA: 2 }),
      livePrices: async () => ({}),
    });
    expect(summary).toMatchObject({ written: 2, failed: 0 });
    const [mine] = await loadPortfolioDays(holder.id);
    expect(mine.holdings[0]).toMatchObject({ symbol: "NVDA", quantity: 2.5, price: 200, source: "mark" });
    expect(mine.value).toBeCloseTo(500, 10);
    // One request for both wallets; each account answered from it.
    expect(requests).toHaveLength(1);
  });

  it("with a Robinhood Chain that does not answer in time, still writes every hub-only day and lets the Robinhood account fall back (rh-server M1)", async () => {
    const delivered = await account(1);
    const hubOnly = [await account(2), await account(3), await account(4)];
    await deliveredThere(await placeOrder(delivered.id));
    for (const user of hubOnly) await placeOrder(user.id);
    await writeMarks("NVDA", [{ day: "2026-09-25", close: 200 }], []);
    // A chain read that takes far longer than any account may wait.
    const slow = makeRobinhoodHoldingsReader(async (queries) => {
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      return queries.map(() => 0n);
    });
    const started = Date.now();
    const summary = await runPortfolioSnapshot({
      now: FRIDAY_EVENING,
      readRobinhood: slow,
      robinhoodBudgetMs: 100,
      accountTimeoutMs: 1_000,
      deriveHubWallet: async (spoke) => spoke,
      readBalances: async () => ({ NVDA: 1 }),
      livePrices: async () => ({}),
    });
    expect(Date.now() - started).toBeLessThan(2_500);
    expect(summary).toMatchObject({ accounts: 4, written: 3, failed: 1 });
    expect(await loadPortfolioDays(delivered.id)).toEqual([]);
    for (const user of hubOnly) expect((await loadPortfolioDays(user.id)).map((day) => day.value)).toEqual([200]);
  });

  it("writes no row for an account delivered there whose Robinhood Chain read failed, and the hub's for one never delivered there", async () => {
    const delivered = await account(1);
    const hubOnly = await account(2);
    await deliveredThere(await placeOrder(delivered.id));
    await placeOrder(hubOnly.id);
    await writeMarks("NVDA", [{ day: "2026-09-25", close: 200 }], []);
    const summary = await runPortfolioSnapshot({
      now: FRIDAY_EVENING,
      readRobinhood: onRobinhood({}),
      deriveHubWallet: async (spoke) => spoke,
      readBalances: async () => ({ NVDA: 1 }),
      livePrices: async () => ({}),
    });
    expect(summary).toMatchObject({ written: 1, failed: 1 });
    expect(await loadPortfolioDays(delivered.id)).toEqual([]);
    expect((await loadPortfolioDays(hubOnly.id)).map((day) => day.value)).toEqual([200]);
  });

  it("reads each wallet's own Robinhood Chain part beside the hub, and throws when it is unknown", async () => {
    const read = await readAccountBalances(
      [wallet(1), wallet(9)],
      async () => ({ NVDA: 1 }),
      async (spoke) => spoke,
      onRobinhood({ [wallet(1)]: { NVDA: 0.5 }, [wallet(9)]: { TSLA: 2 } }),
    );
    expect(read.total).toEqual({ NVDA: 2.5, TSLA: 2 });
    expect(read.robinhood).toEqual({ NVDA: 0.5, TSLA: 2 });
    await expect(
      readAccountBalances([wallet(1)], async () => ({}), async (spoke) => spoke, onRobinhood({})),
    ).rejects.toThrow("unread");
    const hubOnly = await readAccountBalances([wallet(1)], async () => ({ NVDA: 1 }), async (spoke) => spoke, onRobinhood({}), "hub only");
    expect(hubOnly).toMatchObject({ total: { NVDA: 1 }, robinhood: null });
  });

  it("keeps the Robinhood Chain part on the day, and treats an account holding there by transfer as on Robinhood Chain (rh-server m4)", async () => {
    const transferred = await account(1);
    await placeOrder(transferred.id);
    await writeMarks("NVDA", [{ day: "2026-09-24", close: 200 }], []);
    // Thursday: read, with one NVDA in the wallet on Robinhood Chain, though no Berth order went there.
    expect(
      await runPortfolioSnapshot({
        now: new Date("2026-09-24T23:05:00Z"),
        readRobinhood: onRobinhood({ [wallet(1)]: { NVDA: 1 } }),
        deriveHubWallet: async (spoke) => spoke,
        readBalances: async () => ({ NVDA: 1 }),
        livePrices: async () => ({}),
      }),
    ).toMatchObject({ written: 1 });
    expect((await loadPortfolioDays(transferred.id))[0].holdings).toEqual([{ symbol: "NVDA", quantity: 2, price: 200, source: "mark", robinhood: 1 }]);
    expect(await hasRobinhoodOrders(transferred.id)).toBe(true);
    expect((await snapshotAccounts())[0].robinhoodOrders).toBe(true);
    // Friday: Robinhood Chain does not answer. No low day that would look like a sale.
    await writeMarks("NVDA", [{ day: "2026-09-25", close: 200 }], []);
    expect(
      await runPortfolioSnapshot({
        now: FRIDAY_EVENING,
        readRobinhood: onRobinhood({}),
        deriveHubWallet: async (spoke) => spoke,
        readBalances: async () => ({ NVDA: 1 }),
        livePrices: async () => ({}),
      }),
    ).toMatchObject({ written: 0, failed: 1 });
    expect((await loadPortfolioDays(transferred.id)).map((day) => day.day)).toEqual(["2026-09-24"]);
  });

  it("knows whether one account has an order there", async () => {
    const delivered = await account(1);
    const hubOnly = await account(2);
    await deliveredThere(await placeOrder(delivered.id));
    await placeOrder(hubOnly.id);
    expect(await hasRobinhoodOrders(delivered.id)).toBe(true);
    expect(await hasRobinhoodOrders(hubOnly.id)).toBe(false);
  });

  it("knows which accounts were ever delivered there", async () => {
    const delivered = await account(1);
    const hubOnly = await account(2);
    await deliveredThere(await placeOrder(delivered.id));
    await placeOrder(hubOnly.id);
    const flags = Object.fromEntries((await snapshotAccounts()).map((entry) => [entry.id, entry.robinhoodOrders]));
    expect(flags).toEqual({ [delivered.id]: true, [hubOnly.id]: false });
  });
});
