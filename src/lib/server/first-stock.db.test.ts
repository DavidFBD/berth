import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setSqlClient, type SqlClient } from "@/lib/server/db";
import { makeTestDb } from "@/lib/server/pglite-test-db";
import { getOrCreateUser } from "@/lib/server/accounts";
import { closeFirstStock, readFirstStock } from "@/lib/server/first-stock";

/**
 * The first stock card's server side against the real schema: the clock
 * starts at the first buy of a stock (cash does not count), "Got it" holds
 * on the account and a replay keeps the first close.
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

async function user(wallet: string): Promise<string> {
  const made = await getOrCreateUser({ did: null, wallet });
  return made!.user.id;
}

async function buy(userId: string, symbol: string, at: Date, tx: string, filled = true) {
  await sql.query(
    `insert into orders (user_id, intent_tx, direction, listing_symbol, listing_address, placed_at, fill_tx, filled_at)
     values ($1, $2, 'buy', $3, '0x0', $4, $5, $6)`,
    [userId, tx, symbol, at.toISOString(), filled ? `${tx}f` : null, filled ? at.toISOString() : null],
  );
}

describe("readFirstStock and closeFirstStock", () => {
  it("starts the clock at the first stock buy, not at parked cash", async () => {
    const id = await user("0x00000000000000000000000000000000000f1501");
    const now = Date.now();
    await buy(id, "SGOV", new Date(now - 30 * 86_400_000), "0xf1a");
    await buy(id, "NVDA", new Date(now - 2 * 86_400_000), "0xf1b");
    const state = await readFirstStock(id, now);
    expect(state.firstBuyAt).toBe(now - 2 * 86_400_000);
    expect(state).toMatchObject({ closed: false, show: true });
  });

  it("starts the clock only at a filled buy, never at one that failed", async () => {
    const id = await user("0x00000000000000000000000000000000000f1504");
    const now = Date.now();
    await buy(id, "NVDA", new Date(now - 20 * 86_400_000), "0xf4a", false);
    await buy(id, "NVDA", new Date(now - 86_400_000), "0xf4b");
    expect(await readFirstStock(id, now)).toMatchObject({ firstBuyAt: now - 86_400_000, show: true });
  });

  it("stops after two weeks", async () => {
    const id = await user("0x00000000000000000000000000000000000f1502");
    const now = Date.now();
    await buy(id, "AAPL", new Date(now - 15 * 86_400_000), "0xf2a");
    expect((await readFirstStock(id, now)).show).toBe(false);
  });

  it("closes for good, and a replay keeps the first close", async () => {
    const id = await user("0x00000000000000000000000000000000000f1503");
    await buy(id, "TSLA", new Date(), "0xf3a");
    await closeFirstStock(id);
    const [first] = (await sql.query(`select first_stock_closed_at from users where id = $1`, [id])) as { first_stock_closed_at: Date }[];
    await closeFirstStock(id);
    const [again] = (await sql.query(`select first_stock_closed_at from users where id = $1`, [id])) as { first_stock_closed_at: Date }[];
    expect(new Date(again.first_stock_closed_at).getTime()).toBe(new Date(first.first_stock_closed_at).getTime());
    expect(await readFirstStock(id)).toMatchObject({ closed: true, show: false });
  });
});
