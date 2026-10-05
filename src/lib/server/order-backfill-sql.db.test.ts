import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setSqlClient, type SqlClient } from "./db";
import { makeTestDb } from "./pglite-test-db";
import { BACKFILL_ORDER_UPSERT, DELIVERED_TO_UPDATE, backfillOrderParams, deliveredToParams } from "@/lib/order-backfill-sql";
import { holdingChainOf, type OrderRecord } from "@/lib/orders";

/**
 * The statements scripts/orders-backfill.mjs and
 * scripts/backfill-delivered-to.mjs send, run against the schema: neither
 * can leave a Robinhood Chain buy with a null chain, nor move a chain once
 * it is named.
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

const order = (over: Partial<OrderRecord>): OrderRecord => ({
  intentTx: "0xa",
  fillTx: null,
  direction: "buy",
  walletAddress: null,
  deliveredTo: "0x1111111111111111111111111111111111111111",
  listingSymbol: "NVDA",
  listingAddress: "0x2d5d2250ee426ca318efbd03ddf926b23c96f74b",
  quantity: "0.01",
  minQuantity: "0.009",
  paySymbol: "USDC",
  payChain: "0x2105.base",
  payAmount: "5",
  feeAmount: "0.02",
  usdValue: "5",
  usdSource: "stable",
  placedAt: new Date("2026-10-05T09:00:00Z"),
  filledAt: null,
  holdingChain: "robinhood",
  ...over,
});
const chainOf = async (intentTx: string) =>
  ((await sql.query(`select holding_chain from orders where intent_tx = $1`, [intentTx])) as { holding_chain: string | null }[])[0]?.holding_chain;

describe("scripts/orders-backfill.mjs's upsert", () => {
  it("writes a Robinhood Chain buy as held there, and a rerun never moves it", async () => {
    await sql.query(BACKFILL_ORDER_UPSERT, backfillOrderParams(null, order({ intentTx: "0xrh" })));
    expect(await chainOf("0xrh")).toBe("robinhood");
    await sql.query(BACKFILL_ORDER_UPSERT, backfillOrderParams(null, order({ intentTx: "0xrh", holdingChain: "sonic" })));
    expect(await chainOf("0xrh")).toBe("robinhood");
  });

  it("fills the chain into a legacy row that had none", async () => {
    await sql.query(`insert into orders (intent_tx, direction, listing_symbol, listing_address) values ('0xold', 'buy', 'NVDA', '0xl')`, []);
    await sql.query(BACKFILL_ORDER_UPSERT, backfillOrderParams(null, order({ intentTx: "0xold", holdingChain: "sonic" })));
    expect(await chainOf("0xold")).toBe("sonic");
  });
});

describe("scripts/backfill-delivered-to.mjs's update", () => {
  it("writes the chain beside the address, from the intent's destination", async () => {
    await sql.query(`insert into orders (intent_tx, direction, listing_symbol, listing_address) values ('0xd1', 'buy', 'NVDA', '0xl'), ('0xd2', 'buy', 'NVDA', '0xl')`, []);
    await sql.query(DELIVERED_TO_UPDATE, deliveredToParams("0xd1", "0xbuyer", holdingChainOf("buy", { dstChain: 21071n })));
    await sql.query(DELIVERED_TO_UPDATE, deliveredToParams("0xd2", "0xhub", holdingChainOf("buy", { dstChain: 146n })));
    expect(await chainOf("0xd1")).toBe("robinhood");
    expect(await chainOf("0xd2")).toBe("sonic");
  });

  it("touches only rows with no address, and never moves a named chain", async () => {
    await sql.query(BACKFILL_ORDER_UPSERT, backfillOrderParams(null, order({ intentTx: "0xd3", deliveredTo: null })));
    const touched = (await sql.query(DELIVERED_TO_UPDATE, deliveredToParams("0xd3", "0xelse", "sonic"))) as unknown[];
    expect(touched).toHaveLength(1);
    expect(await chainOf("0xd3")).toBe("robinhood");
    expect((await sql.query(DELIVERED_TO_UPDATE, deliveredToParams("0xd3", "0xagain", "sonic"))) as unknown[]).toHaveLength(0);
  });
});
