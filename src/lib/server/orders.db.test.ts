import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setSqlClient, type SqlClient } from "./db";
import { makeTestDb } from "./pglite-test-db";
import { saveOrder } from "./orders";
import type { OrderRecord } from "@/lib/orders";

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

const base: OrderRecord = {
  intentTx: "0xintent",
  fillTx: null,
  direction: "buy",
  walletAddress: "0xwallet",
  listingSymbol: "SGOV",
  listingAddress: "0xlisting",
  quantity: null,
  minQuantity: "0.0187",
  paySymbol: "USDC",
  payChain: "0x38.bsc",
  payAmount: "2",
  feeAmount: "0.008",
  usdValue: "2",
  usdSource: "stable",
  placedAt: new Date("2026-09-21T09:19:00Z"),
  filledAt: null,
};

describe("saveOrder", () => {
  it("writes once per intent, and a later call only fills the gaps", async () => {
    await saveOrder(null, base);
    await saveOrder(null, {
      ...base,
      fillTx: "0xfill",
      quantity: "0.01891",
      filledAt: new Date("2026-09-21T09:20:00Z"),
      usdValue: null,
    });
    const rows = (await sql.query(
      `select fill_tx, quantity::text, usd_value::text from orders where intent_tx = '0xintent'`,
      [],
    )) as { fill_tx: string; quantity: string; usd_value: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ fill_tx: "0xfill", quantity: "0.01891", usd_value: "2" });
  });
});
