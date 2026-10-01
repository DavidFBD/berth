import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setSqlClient, type SqlClient } from "@/lib/server/db";
import { makeTestDb } from "@/lib/server/pglite-test-db";
import {
  accountsByStage,
  activeAccounts,
  firstBuySummary,
  firstBuysByWeek,
  holdingsValue,
  ordersPerDay,
  readOverview,
  referrals,
  retentionByWeek,
  signupsPerDay,
  signupsPerWeek,
  topListings,
  volumeTotals,
} from "./overview";

/**
 * The Overview's metrics against the real schema (PGlite), on a small
 * harbour whose every number is known by hand.
 */

let sql: SqlClient;
let close: () => Promise<void>;

const DAY = 86_400_000;
const ago = (days: number, hours = 0) => new Date(Date.now() - days * DAY - hours * 3_600_000).toISOString();
const utcDay = (iso: string) => iso.slice(0, 10);

let n = 0;
async function account({ createdAt, updatedAt, referredBy = null, retiredInto = null }: { createdAt: string; updatedAt?: string; referredBy?: string | null; retiredInto?: string | null }) {
  n += 1;
  const rows = (await sql.query(
    `insert into users (privy_did, created_at, updated_at, referred_by, retired_into) values ($1, $2, $3, $4, $5) returning id`,
    [`did:privy:o${n}`, createdAt, updatedAt ?? createdAt, referredBy, retiredInto],
  )) as { id: string }[];
  return rows[0].id;
}

let tx = 0;
async function order(userId: string, { at, direction = "buy", symbol = "NVDA", quantity = 1, usd = 100 as number | null }: { at: string; direction?: "buy" | "sell"; symbol?: string; quantity?: number; usd?: number | null }) {
  tx += 1;
  await sql.query(
    `insert into orders (user_id, intent_tx, fill_tx, direction, listing_symbol, listing_address, quantity, usd_value, placed_at, filled_at)
     values ($1, $2, $3, $4, $5, '0x0', $6, $7, $8, $8)`,
    [userId, `0xintent${tx}`, `0xfill${tx}`, direction, symbol, quantity, usd, at],
  );
}

async function day(userId: string, daysAgo: number, value: number, holdings: { symbol: string; quantity: number }[]) {
  await sql.query(
    `insert into portfolio_days (user_id, day, value_usd, holdings, source, as_of) values ($1, (now() at time zone 'UTC')::date - $2::int, $3, $4::jsonb, 'snapshot', now())`,
    [userId, daysAgo, value, JSON.stringify(holdings.map((h) => ({ ...h, price: 1, source: "mark" })))],
  );
}

let owner: string, cashOnly: string, oldBuyer: string, empty: string, referred: string, merged: string;

beforeAll(async () => {
  const db = await makeTestDb();
  sql = db.sql;
  close = db.close;
  setSqlClient(sql);

  // owns: a stored day holding NVDA; first buy two hours after signing up.
  owner = await account({ createdAt: ago(3), updatedAt: ago(0, 1) });
  await order(owner, { at: ago(3, -2), usd: 250 });
  await day(owner, 1, 260, [{ symbol: "NVDA", quantity: 1 }]);
  // funded: only Cash in its latest day; its SGOV buy is not a first buy.
  cashOnly = await account({ createdAt: ago(10), updatedAt: ago(9) });
  await order(cashOnly, { at: ago(9), symbol: "SGOV", usd: 50 });
  await day(cashOnly, 2, 50, [{ symbol: "SGOV", quantity: 0.5 }]);
  // owns by its orders alone (no stored day): bought 20 days in, unpriced.
  oldBuyer = await account({ createdAt: ago(40), updatedAt: ago(40) });
  await order(oldBuyer, { at: ago(20), symbol: "AAPL", usd: null });
  // none: nothing at all, not active.
  empty = await account({ createdAt: ago(60), updatedAt: ago(60) });
  // referred by the owner, bought a day and a half in, then sold.
  referred = await account({ createdAt: ago(5), updatedAt: ago(4), referredBy: owner });
  await order(referred, { at: ago(5, -36), usd: 40 });
  await order(referred, { at: ago(2), direction: "sell", usd: 30 });
  // merged into the owner: never counted.
  merged = await account({ createdAt: ago(1), retiredInto: owner });

  await sql.query(`insert into referral_clicks (code, created_at) values ('A', now()), ('A', now() - interval '40 days'), ('B', now())`);
  await sql.query(`insert into friend_requests (from_id, to_id, via, status) values ($1, $2, 'link', 'accepted'), ($3, $2, 'link', 'pending'), ($3, $1, 'handle', 'accepted')`, [
    empty,
    owner,
    oldBuyer,
  ]);
});

afterAll(async () => {
  setSqlClient(null);
  await close();
});

describe("staff overview", () => {
  it("counts signups per day and week, merged accounts left out", async () => {
    const daily = await signupsPerDay(30);
    expect(daily).toHaveLength(30);
    expect(daily.reduce((sum, row) => sum + row.n, 0)).toBe(3); // owner, cashOnly, referred
    expect(daily.find((row) => row.day === utcDay(ago(3)))?.n).toBeGreaterThanOrEqual(1);
    expect(daily.find((row) => row.day === utcDay(ago(1)))?.n ?? 0).toBe(0); // the merged one
    const weekly = await signupsPerWeek(12);
    expect(weekly).toHaveLength(12);
    expect(weekly.reduce((sum, row) => sum + row.n, 0)).toBe(5);
    expect(merged).toBeTruthy();
  });

  it("sorts accounts into stages as the server can tell them", async () => {
    expect(await accountsByStage()).toEqual({ owns: 2, funded: 2, none: 1 });
  });

  it("measures the first buy the way pnpm first-buys does", async () => {
    const summary = await firstBuySummary();
    expect(summary).toMatchObject({ accounts: 5, firstBuys: 3, withinADay: 1, withinAWeek: 2 });
    expect(summary.rate).toBeCloseTo(3 / 5);
    // 2h, 36h and 20 days: the median is 36 hours.
    expect(summary.medianHours).toBe(36);
    const weeks = await firstBuysByWeek(12);
    expect(weeks.reduce((sum, row) => sum + row.signups, 0)).toBe(5);
    expect(weeks.reduce((sum, row) => sum + row.firstBuys, 0)).toBe(3);
  });

  it("counts active accounts by sync, order or assistant use", async () => {
    expect(await activeAccounts()).toEqual({ total: 5, d7: 2, d30: 4 });
    await sql.query(`insert into chat_usage (user_id, provider, model, steps, input_tokens, output_tokens, cost_micros, ok, duration_ms) values ($1, 'openai', 'm', 1, 1, 1, 1, true, 1)`, [empty]);
    expect(await activeAccounts()).toEqual({ total: 5, d7: 3, d30: 5 });
    await sql.query(`delete from chat_usage`);
  });

  it("counts a visit by last_seen_at, never by an XP award's updated_at", async () => {
    const before = await activeAccounts();
    await sql.query(`update users set updated_at = now() where id = $1`, [empty]);
    expect(await activeAccounts()).toEqual(before);
    await sql.query(`update users set last_seen_at = now() where id = $1`, [empty]);
    expect(await activeAccounts()).toEqual({ ...before, d7: before.d7 + 1, d30: before.d30 + 1 });
    await sql.query(`update users set last_seen_at = null where id = $1`, [empty]);
  });

  it("clamps a first buy recorded before the account existed to no time at all", async () => {
    const early = await account({ createdAt: ago(1) });
    await order(early, { at: ago(4) });
    const summary = await firstBuySummary();
    expect(summary.medianHours).toBeGreaterThanOrEqual(0);
    await sql.query(`delete from orders where user_id = $1`, [early]);
    await sql.query(`update users set retired_into = $2 where id = $1`, [early, owner]);
  });

  it("uses the fee an order recorded where it can be priced", async () => {
    const before = (await volumeTotals()).all.feeEstimateUsd;
    await sql.query(`update orders set fee_amount = 1, pay_amount = 100 where user_id = $1 and direction = 'buy'`, [owner]);
    // owner's buy: $250 at 1/100 is $2.50, where the estimate said $1.00.
    expect((await volumeTotals()).all.feeEstimateUsd).toBeCloseTo(before - 1 + 2.5);
    await sql.query(`update orders set fee_amount = null, pay_amount = null where user_id = $1`, [owner]);
  });

  it("sums orders, volume and the fee estimate, unpriced orders apart", async () => {
    const days = await ordersPerDay(30);
    expect(days).toHaveLength(30);
    expect(days.reduce((sum, row) => sum + row.orders, 0)).toBe(5);
    expect(days.reduce((sum, row) => sum + row.sells, 0)).toBe(1);
    expect(days.reduce((sum, row) => sum + row.volumeUsd, 0)).toBe(370);
    expect(days.reduce((sum, row) => sum + row.unpriced, 0)).toBe(1);
    const totals = await volumeTotals();
    expect(totals.all).toEqual({ orders: 5, volumeUsd: 370, feeEstimateUsd: 370 * 0.004, unpriced: 1 });
    expect(totals.d30.orders).toBe(5);
  });

  it("adds up the latest stored close per account", async () => {
    const value = await holdingsValue();
    expect(value).toMatchObject({ totalUsd: 310, accounts: 2 });
    expect(value.asOf).toBe(utcDay(new Date(Date.now() - DAY).toISOString()));
  });

  it("reads retention by signup week from orders and activity", async () => {
    const weeks = await retentionByWeek(12);
    const total = (key: "signups" | "orderedWeek1" | "orderedWeeks2to5" | "active30") => weeks.reduce((sum, row) => sum + row[key], 0);
    expect(total("signups")).toBe(5);
    expect(total("orderedWeek1")).toBe(2); // owner, referred (cashOnly bought Cash, which is not a buy here)
    expect(total("orderedWeeks2to5")).toBe(1); // oldBuyer at day 20
    expect(total("active30")).toBe(4);
  });

  it("follows invites from the click to the first buy, and friend links", async () => {
    expect(await referrals()).toEqual({
      clicks: 3,
      clicks30: 2,
      referredSignups: 1,
      referredFirstBuys: 1,
      linkRequests: 2,
      linkAccepted: 1,
    });
  });

  it("ranks listings by how many accounts bought them", async () => {
    const top = await topListings(5);
    expect(top[0]).toEqual({ symbol: "NVDA", buyers: 2, orders: 2, volumeUsd: 290 });
    // Cash is not a listing anyone "bought" here, and sells never count.
    expect(top.map((row) => row.symbol)).toEqual(["NVDA", "AAPL"]);
  });

  it("reads everything at once", async () => {
    const overview = await readOverview();
    expect(overview.stages.owns).toBe(2);
    expect(overview.topListings.length).toBe(2);
  });
});
