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
  deliveredTo: null,
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
  holdingChain: "sonic",
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
      deliveredTo: "0xhub",
    });
    await saveOrder(null, { ...base, deliveredTo: "0xother" });
    const rows = (await sql.query(
      `select fill_tx, quantity::text, usd_value::text, delivered_to from orders where intent_tx = '0xintent'`,
      [],
    )) as { fill_tx: string; quantity: string; usd_value: string; delivered_to: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      fill_tx: "0xfill",
      quantity: "0.01891",
      usd_value: "2",
      delivered_to: "0xhub",
    });
  });
});

describe("saveOrder and the holding chain", () => {
  const chainOf = async (intentTx: string) =>
    ((await sql.query(`select holding_chain from orders where intent_tx = $1`, [intentTx])) as { holding_chain: string | null }[])[0]
      ?.holding_chain;

  it("names the chain on every new row: a Robinhood Chain buy as robinhood, with its Sonic listing address", async () => {
    await saveOrder(null, { ...base, intentTx: "0xrh1", holdingChain: "robinhood", deliveredTo: "0xbuyer" });
    await saveOrder(null, { ...base, intentTx: "0xhub1" });
    expect(await chainOf("0xrh1")).toBe("robinhood");
    expect(await chainOf("0xhub1")).toBe("sonic");
    const row = ((await sql.query(`select listing_address from orders where intent_tx = '0xrh1'`, [])) as { listing_address: string }[])[0];
    expect(row.listing_address).toBe("0xlisting");
  });

  it("names a sell from Robinhood Chain robinhood too, a sell like any other", async () => {
    await saveOrder(null, { ...base, intentTx: "0xrhsell", direction: "sell", holdingChain: "robinhood", quantity: "0.5", deliveredTo: "0xpayout" });
    expect(await chainOf("0xrhsell")).toBe("robinhood");
    const row = ((await sql.query(`select direction, listing_address, quantity::text from orders where intent_tx = '0xrhsell'`, [])) as {
      direction: string;
      listing_address: string;
      quantity: string;
    }[])[0];
    expect(row).toEqual({ direction: "sell", listing_address: "0xlisting", quantity: "0.5" });
  });

  it("never moves a row's chain once named, and fills a legacy null in", async () => {
    await saveOrder(null, { ...base, intentTx: "0xrh1", holdingChain: "sonic", quantity: "1" });
    expect(await chainOf("0xrh1")).toBe("robinhood");
    await sql.query(
      `insert into orders (intent_tx, direction, listing_symbol, listing_address) values ('0xlegacy', 'buy', 'SGOV', '0xlisting')`,
      [],
    );
    expect(await chainOf("0xlegacy")).toBeNull();
    await saveOrder(null, { ...base, intentTx: "0xlegacy", holdingChain: "robinhood" });
    expect(await chainOf("0xlegacy")).toBe("robinhood");
  });
});
