import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setSqlClient, type SqlClient } from "./db";
import { makeTestDb } from "./pglite-test-db";
import { getOrCreateUser } from "./accounts";
import { writeMarks } from "./marks";
import { runEvening } from "./evening";
import { backfillAccountHistory, backfillCandidates, backfillHistories } from "./history-backfill";
import { loadPortfolioDays, runPortfolioSnapshot, savePortfolioDay } from "./portfolio";

/** Nothing on Robinhood Chain, read without a network call. */
const nothingOnRobinhood = async (owners: readonly string[]) =>
  new Map(owners.map((owner) => [owner.toLowerCase(), {} as Record<string, number>]));

/**
 * History back to the first buy, against a real Postgres with the real
 * schema. September 2026: Mon 21 to Fri 25; the first snapshot is Friday
 * evening's, and the days before it are rebuilt from the orders only when
 * they explain what that snapshot held.
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
const FRIDAY_EVENING = new Date("2026-09-25T22:40:00Z");
let intents = 0;
const order = async (
  userId: string,
  { at, symbol = "NVDA", quantity = 1, usd = 100, direction = "buy", from }: {
    at: string;
    symbol?: string;
    quantity?: number;
    usd?: number;
    direction?: "buy" | "sell";
    from?: string;
  },
) => {
  intents += 1;
  await sql.query(
    `insert into orders (user_id, wallet_address, intent_tx, direction, listing_symbol, listing_address, quantity, usd_value, placed_at, filled_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $9::timestamptz)`,
    [userId, from ?? null, `0x${String(intents).padStart(64, "0")}`, direction, symbol, `0x${symbol.toLowerCase()}`, quantity, usd, at],
  );
};
const WEEK = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25"];
const closes = async (symbol: string, values: number[]) =>
  writeMarks(symbol, WEEK.map((day, index) => ({ day, close: values[index] })), []);
const snapshot = (userId: string, holdings: Record<string, number>, prices: Record<string, number>) =>
  savePortfolioDay(
    userId,
    "2026-09-25",
    {
      value: Object.entries(holdings).reduce((sum, [symbol, quantity]) => sum + quantity * prices[symbol], 0),
      holdings: Object.entries(holdings).map(([symbol, quantity]) => ({ symbol, quantity, price: prices[symbol], source: "mark" as const })),
    },
    "snapshot",
    FRIDAY_EVENING.toISOString(),
  );
const view = async (userId: string) =>
  (await loadPortfolioDays(userId)).map((day) => [
    day.day,
    Number(day.value.toFixed(6)),
    day.source,
    Object.fromEntries(day.holdings.map((holding) => [holding.symbol, Number(holding.quantity.toFixed(9))])),
  ]);
const count = async () => ((await sql.query(`select count(*)::int as n from portfolio_days`)) as { n: number }[])[0].n;

describe("history back to the first buy", () => {
  it("buy then hold: a dry run writes nothing, --write fills the days before the first snapshot, a second run adds none", async () => {
    const user = await account(1);
    await order(user.id, { at: "2026-09-21T15:00:00Z" });
    await closes("NVDA", [100, 102, 101, 104, 105]);
    await snapshot(user.id, { NVDA: 1 }, { NVDA: 105 });

    const dry = await backfillAccountHistory(user.id);
    expect(dry).toMatchObject({ verdict: "explained", firstBuyDay: "2026-09-21", firstSnapshotDay: "2026-09-25", written: 0 });
    expect(dry.rows.map((row) => [row.day, row.value])).toEqual([
      ["2026-09-21", 100],
      ["2026-09-22", 102],
      ["2026-09-23", 101],
      ["2026-09-24", 104],
    ]);
    expect(await count()).toBe(1);

    expect((await backfillAccountHistory(user.id, { write: true })).written).toBe(4);
    expect(await view(user.id)).toEqual([
      ["2026-09-21", 100, "ledger", { NVDA: 1 }],
      ["2026-09-22", 102, "ledger", { NVDA: 1 }],
      ["2026-09-23", 101, "ledger", { NVDA: 1 }],
      ["2026-09-24", 104, "ledger", { NVDA: 1 }],
      ["2026-09-25", 105, "snapshot", { NVDA: 1 }],
    ]);
    const again = await backfillAccountHistory(user.id, { write: true });
    expect(again).toMatchObject({ verdict: "reaches_first_buy", written: 0, rows: [] });
    expect(await count()).toBe(5);
  });

  it("buy, sell, buy: each day holds what the orders placed before its close add up to", async () => {
    const user = await account(2);
    await order(user.id, { at: "2026-09-21T15:00:00Z", quantity: 2, usd: 200 });
    // Before Tuesday's close, so Tuesday holds one.
    await order(user.id, { at: "2026-09-22T16:00:00Z", quantity: 1, direction: "sell", usd: 102 });
    // After Wednesday's close (21:30 UTC), so it first counts on Thursday.
    await order(user.id, { at: "2026-09-23T22:00:00Z", quantity: 0.5, usd: 50.5 });
    await closes("NVDA", [100, 102, 101, 104, 105]);
    await snapshot(user.id, { NVDA: 1.5 }, { NVDA: 105 });

    const report = await backfillAccountHistory(user.id, { write: true });
    expect(report).toMatchObject({ verdict: "explained", written: 4 });
    expect(await view(user.id)).toEqual([
      ["2026-09-21", 200, "ledger", { NVDA: 2 }],
      ["2026-09-22", 102, "ledger", { NVDA: 1 }],
      ["2026-09-23", 101, "ledger", { NVDA: 1 }],
      ["2026-09-24", 156, "ledger", { NVDA: 1.5 }],
      ["2026-09-25", 157.5, "snapshot", { NVDA: 1.5 }],
    ]);
  });

  it("a multi-wallet account: the orders from every linked wallet explain the summed snapshot", async () => {
    const user = await account(3);
    await order(user.id, { at: "2026-09-22T15:00:00Z", from: wallet(3) });
    await order(user.id, { at: "2026-09-23T15:00:00Z", symbol: "AAPL", quantity: 2, usd: 400, from: wallet(33) });
    await closes("NVDA", [100, 102, 101, 104, 105]);
    await closes("AAPL", [200, 201, 202, 203, 204]);
    const taken = await runPortfolioSnapshot({
      readRobinhood: nothingOnRobinhood,
      now: FRIDAY_EVENING,
      accounts: [{ id: user.id, wallet: wallet(3), wallets: [wallet(3), wallet(33)] }],
      deriveHubWallet: async (spoke) => `hub-${spoke}`,
      readBalances: async (hub): Promise<Record<string, number>> => (hub === `hub-${wallet(3)}` ? { NVDA: 1 } : { AAPL: 2 }),
      livePrices: async () => ({}),
    });
    expect(taken.written).toBe(1);

    expect(await backfillAccountHistory(user.id, { write: true })).toMatchObject({ verdict: "explained", written: 3 });
    expect(await view(user.id)).toEqual([
      ["2026-09-22", 102, "ledger", { NVDA: 1 }],
      ["2026-09-23", 505, "ledger", { AAPL: 2, NVDA: 1 }],
      ["2026-09-24", 510, "ledger", { AAPL: 2, NVDA: 1 }],
      ["2026-09-25", 513, "snapshot", { AAPL: 2, NVDA: 1 }],
    ]);
  });

  it("a merged account: the joined orders rebuild the survivor's days, the summed snapshot stays as it was", async () => {
    const { mergeAccounts } = await import("./account-merge");
    const survivor = await account(4);
    const absorbed = await account(5);
    await sql.query(`update users set email = 'merged@example.com' where id = $1`, [survivor.id]);
    await order(absorbed.id, { at: "2026-09-21T15:00:00Z" });
    await order(survivor.id, { at: "2026-09-22T15:00:00Z", symbol: "AAPL", usd: 201 });
    await closes("NVDA", [100, 102, 101, 104, 105]);
    await closes("AAPL", [200, 201, 202, 203, 204]);
    await snapshot(survivor.id, { AAPL: 1 }, { AAPL: 204 });
    await snapshot(absorbed.id, { NVDA: 1 }, { NVDA: 105 });
    await sql.query(`update portfolio_days set created_at = '2026-09-25T22:40:00Z'`);
    expect((await mergeAccounts({ survivor: survivor.id, absorbed: absorbed.id, reason: "email" })).ok).toBe(true);
    await sql.query(`update users set retired_at = '2026-09-26T12:00:00Z' where id = $1`, [absorbed.id]);
    const before = await view(survivor.id);
    expect(before).toEqual([["2026-09-25", 309, "snapshot", { AAPL: 1, NVDA: 1 }]]);

    const report = await backfillAccountHistory(survivor.id, { write: true });
    expect(report).toMatchObject({ verdict: "explained", firstBuyDay: "2026-09-21", written: 4 });
    expect(await view(survivor.id)).toEqual([
      ["2026-09-21", 100, "ledger", { NVDA: 1 }],
      ["2026-09-22", 303, "ledger", { AAPL: 1, NVDA: 1 }],
      ["2026-09-23", 303, "ledger", { AAPL: 1, NVDA: 1 }],
      ["2026-09-24", 307, "ledger", { AAPL: 1, NVDA: 1 }],
      before[0],
    ]);
    // The retired account's own rows are never touched.
    expect(await view(absorbed.id)).toEqual([["2026-09-25", 105, "snapshot", { NVDA: 1 }]]);
  });

  it("a merged account whose survivor has no row on the first snapshot's day: nothing written, since it would hide that snapshot", async () => {
    const { mergeAccounts } = await import("./account-merge");
    const survivor = await account(6);
    const absorbed = await account(7);
    await sql.query(`update users set email = 'gap@example.com' where id = $1`, [survivor.id]);
    await order(absorbed.id, { at: "2026-09-21T15:00:00Z" });
    await closes("NVDA", [100, 102, 101, 104, 105]);
    await snapshot(absorbed.id, { NVDA: 1 }, { NVDA: 105 });
    await sql.query(`update portfolio_days set created_at = '2026-09-25T22:40:00Z'`);
    expect((await mergeAccounts({ survivor: survivor.id, absorbed: absorbed.id, reason: "email" })).ok).toBe(true);
    await sql.query(`update users set retired_at = '2026-09-26T12:00:00Z' where id = $1`, [absorbed.id]);

    const report = await backfillAccountHistory(survivor.id, { write: true });
    expect(report).toMatchObject({ verdict: "merge_conflict", written: 0, rows: [] });
    expect(await view(survivor.id)).toEqual([["2026-09-25", 105, "snapshot", { NVDA: 1 }]]);
  });

  it("unexplained: money moved without an order, so nothing is written and the history keeps its start", async () => {
    const user = await account(8);
    await order(user.id, { at: "2026-09-21T15:00:00Z" });
    await closes("NVDA", [100, 102, 101, 104, 105]);
    // Three held where the orders bought one: a transfer in.
    await snapshot(user.id, { NVDA: 3 }, { NVDA: 105 });
    const report = await backfillAccountHistory(user.id, { write: true });
    expect(report).toMatchObject({ verdict: "unexplained", written: 0, rows: [] });
    expect(await view(user.id)).toEqual([["2026-09-25", 315, "snapshot", { NVDA: 3 }]]);
  });

  it("never writes over a stored row: a day already stored keeps its row, the snapshot keeps its own", async () => {
    const user = await account(9);
    await order(user.id, { at: "2026-09-21T15:00:00Z" });
    await closes("NVDA", [100, 102, 101, 104, 105]);
    await savePortfolioDay(user.id, "2026-09-23", { value: 77, holdings: [{ symbol: "NVDA", quantity: 1, price: 77, source: "mark" }] }, "ledger", "2026-09-23T21:30:00Z");
    await snapshot(user.id, { NVDA: 1 }, { NVDA: 105 });

    expect(await backfillAccountHistory(user.id, { write: true })).toMatchObject({ verdict: "explained", written: 3 });
    expect((await view(user.id)).map(([day, value, source]) => [day, value, source])).toEqual([
      ["2026-09-21", 100, "ledger"],
      ["2026-09-22", 102, "ledger"],
      ["2026-09-23", 77, "ledger"],
      ["2026-09-24", 104, "ledger"],
      ["2026-09-25", 105, "snapshot"],
    ]);
  });

  it("skips a day a held listing has no close for, and says there is no snapshot yet when there is none", async () => {
    const user = await account(10);
    await order(user.id, { at: "2026-09-21T15:00:00Z" });
    expect(await backfillAccountHistory(user.id)).toMatchObject({ verdict: "no_snapshot", rows: [] });
    await writeMarks("NVDA", [{ day: "2026-09-21", close: 100 }, { day: "2026-09-23", close: 101 }, { day: "2026-09-25", close: 105 }], []);
    await snapshot(user.id, { NVDA: 1 }, { NVDA: 105 });
    const report = await backfillAccountHistory(user.id);
    expect(report.rows.map((row) => row.day)).toEqual(["2026-09-21", "2026-09-23"]);
  });
});

describe("which accounts the backfill looks at", () => {
  it("those whose stored days start after their first order, survivors only, none waiting on a merge rebuild", async () => {
    const gap = await account(11);
    const reaches = await account(12);
    const flagged = await account(13);
    const never = await account(14);
    for (const user of [gap, reaches, flagged]) await order(user.id, { at: "2026-09-21T15:00:00Z" });
    await order(never.id, { at: "2026-09-21T15:00:00Z" });
    await closes("NVDA", [100, 102, 101, 104, 105]);
    for (const user of [gap, flagged]) await snapshot(user.id, { NVDA: 1 }, { NVDA: 105 });
    await savePortfolioDay(reaches.id, "2026-09-21", { value: 100, holdings: [] }, "ledger", "2026-09-21T21:30:00Z");
    await sql.query(`update users set portfolio_rebuild_at = now() where id = $1`, [flagged.id]);
    expect(await backfillCandidates()).toEqual([gap.id]);
    expect(await backfillCandidates({ limit: 0 })).toEqual([]);

    const summary = await backfillHistories({ write: false });
    expect(summary).toMatchObject({ accounts: 1, explained: 1, days: 4, written: 0 });
    expect(await count()).toBe(3);
  });

  it("runs in the evening beside the order marks, writes, and a second evening adds nothing", async () => {
    const user = await account(15);
    await order(user.id, { at: "2026-09-21T15:00:00Z" });
    await closes("NVDA", [100, 102, 101, 104, 105]);
    await snapshot(user.id, { NVDA: 1 }, { NVDA: 105 });
    const stubs = {
      marks: async () => ({ symbols: 0, written: 0, dropped: 0, revalued: 0, empty: [], failures: [] }),
      orderMarks: async () => ({ orders: 0, written: 0, failed: 0 }),
      snapshot: async () => ({ day: null, accounts: 0, written: 0, empty: 0, oraclePriced: 0, failed: 0, unreached: 0 }),
    };
    const first = await runEvening(stubs);
    expect(first.histories).toMatchObject({ ok: true, result: { accounts: 1, explained: 1, written: 4 } });
    expect(first.written).toBe(4);
    const second = await runEvening(stubs);
    expect(second.histories).toMatchObject({ ok: true, result: { accounts: 0, written: 0 } });
  });
});
