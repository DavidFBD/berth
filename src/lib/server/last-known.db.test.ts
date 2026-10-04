import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setSqlClient, type SqlClient } from "@/lib/server/db";
import { makeTestDb } from "@/lib/server/pglite-test-db";
import { getOrCreateUser } from "@/lib/server/accounts";
import { readLastKnown, saveLastKnown } from "@/lib/server/last-known";
import type { LastKnownSnapshot } from "@/lib/last-known";

/**
 * The last-known home against the real schema: the account's own saved
 * reading first, else its latest daily snapshot, else nothing, and only
 * ever its own.
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

const reading = (over: Partial<LastKnownSnapshot> = {}): LastKnownSnapshot => ({
  v: 1,
  stage: "owns",
  stocks: 6.5,
  cash: 2.2,
  funds: 41.37,
  waiting: 0,
  holdings: [{ symbol: "NVDA", quantity: 0.031, worth: 6.5 }],
  ...over,
});

describe("readLastKnown and saveLastKnown", () => {
  it("has nothing for an account with no reading and no day", async () => {
    expect(await readLastKnown(await user("0x00000000000000000000000000000000001a5701"))).toBeNull();
  });

  it("falls back to the latest daily snapshot, which never knew funds", async () => {
    const id = await user("0x00000000000000000000000000000000001a5702");
    const holdings = (rows: object[]) => JSON.stringify(rows);
    await sql.query(
      `insert into portfolio_days (user_id, day, value_usd, holdings, source, as_of) values
       ($1, '2026-10-01', 8.7, $2::jsonb, 'snapshot', '2026-10-02T22:44:00Z'),
       ($1, '2026-09-30', 7.1, $3::jsonb, 'snapshot', '2026-10-01T22:44:00Z')`,
      [
        id,
        holdings([
          { symbol: "NVDA", quantity: 0.02, price: 180, source: "mark" },
          { symbol: "SGOV", quantity: 0.02, price: 100, source: "mark" },
        ]),
        holdings([{ symbol: "NVDA", quantity: 0.01, price: 170, source: "mark" }]),
      ],
    );
    const found = await readLastKnown(id);
    expect(found?.source).toBe("day");
    expect(found?.asOf).toBe(Date.parse("2026-10-02T22:44:00Z"));
    expect(found?.snapshot.stocks).toBeCloseTo(3.6);
    expect(found?.snapshot.cash).toBeCloseTo(2);
    expect(found?.snapshot.funds).toBeNull();
    expect(found?.snapshot.stage).toBe("owns");
  });

  it("prefers the account's own reading, replaced in place, and keeps it to the account", async () => {
    const id = await user("0x00000000000000000000000000000000001a5703");
    const other = await user("0x00000000000000000000000000000000001a5704");
    const first = await saveLastKnown(id, reading());
    expect(first.source).toBe("live");
    expect((await readLastKnown(id))?.snapshot).toEqual(reading());
    await saveLastKnown(id, reading({ funds: 12 }));
    expect((await readLastKnown(id))?.snapshot.funds).toBe(12);
    expect(await readLastKnown(other)).toBeNull();
    const rows = (await sql.query(`select count(*)::int as n from home_last_known where user_id = $1`, [id])) as { n: number }[];
    expect(rows[0].n).toBe(1);
  });

  it("reads a stored row that no longer parses as no reading of its own", async () => {
    const id = await user("0x00000000000000000000000000000000001a5705");
    await sql.query(`insert into home_last_known (user_id, snapshot) values ($1, '{"v":9}'::jsonb)`, [id]);
    expect(await readLastKnown(id)).toBeNull();
  });
});
