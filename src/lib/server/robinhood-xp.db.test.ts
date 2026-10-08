import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setSqlClient, type SqlClient } from "./db";
import { makeTestDb } from "./pglite-test-db";
import { getOrCreateUser } from "./accounts";
import { robinhoodPourXp } from "./robinhood-xp";
import type { RobinhoodBalanceReader } from "./robinhood-balances";
import { TOKEN_LISTINGS } from "@/lib/listings";

/**
 * When an order on Robinhood Chain earns its pour XP (owner decisions D1
 * and D2), against the real schema: a buy once its delivery is in the
 * wallet, a sell only up to the Berth buys delivered there.
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
  await sql.query("delete from xp_events");
  await sql.query("delete from orders");
  await sql.query("delete from users");
});

const NVDA = TOKEN_LISTINGS.find((listing) => listing.symbol === "NVDA")!;
const WALLET = "0x00000000000000000000000000000000000000aa";
const ONE = 10n ** 18n;
let seq = 0;
const tx = () => `0x${String(++seq).padStart(64, "0")}`;
const user = async () => (await getOrCreateUser({ did: null, wallet: WALLET }))!.user.id;

async function order(
  userId: string,
  {
    direction = "buy",
    chain = "robinhood",
    quantity = "1",
    at = "2026-10-01T10:00:00Z",
    listing = NVDA.address.toLowerCase(),
  }: { direction?: "buy" | "sell"; chain?: "robinhood" | "sonic"; quantity?: string | null; at?: string; listing?: string } = {},
): Promise<string> {
  const intentTx = tx();
  await sql.query(
    `insert into orders (user_id, intent_tx, direction, listing_symbol, listing_address, quantity, placed_at, delivered_to, holding_chain)
     values ($1, $2, $3, 'NVDA', $4, $5, $6::timestamptz, $7, $8)`,
    [userId, intentTx, direction, listing, quantity, at, WALLET, chain],
  );
  return intentTx;
}

const holding = (balance: bigint | null): RobinhoodBalanceReader & { mock: { calls: unknown[][] } } =>
  vi.fn(async (queries) => queries.map(() => balance)) as never;

describe("a buy delivered on Robinhood Chain (D1)", () => {
  it("earns once the delivered quantity is in the wallet it went to, read fresh on its token there", async () => {
    const intentTx = await order(await user(), { quantity: "1.5" });
    const reader = holding((3n * ONE) / 2n);
    expect(await robinhoodPourXp(intentTx, { onRobinhood: true, readBalances: reader })).toBe("pay");
    expect(reader.mock.calls[0][0]).toEqual([{ holder: WALLET, token: NVDA.rhAddress }]);
  });

  it("waits while it is not there, while the chain does not answer, and while the fill's quantity is unknown", async () => {
    const id = await user();
    const intentTx = await order(id, { quantity: "1.5" });
    expect(await robinhoodPourXp(intentTx, { onRobinhood: true, readBalances: holding(ONE) })).toBe("wait");
    expect(await robinhoodPourXp(intentTx, { onRobinhood: true, readBalances: holding(null) })).toBe("wait");
    expect(await robinhoodPourXp(intentTx, { onRobinhood: true, readBalances: async () => ["reverted"] })).toBe("wait");
    const unread = await order(id, { quantity: null });
    expect(await robinhoodPourXp(unread, { onRobinhood: true, readBalances: holding(10n * ONE) })).toBe("wait");
    // Not recorded yet: waits on Robinhood Chain, pays on the hub as before.
    expect(await robinhoodPourXp(tx(), { onRobinhood: true, readBalances: holding(10n * ONE) })).toBe("wait");
    expect(await robinhoodPourXp(tx(), { onRobinhood: false, readBalances: holding(0n) })).toBe("pay");
  });

  it("leaves a hub order alone, whatever Robinhood Chain says", async () => {
    const intentTx = await order(await user(), { chain: "sonic" });
    const reader = holding(0n);
    expect(await robinhoodPourXp(intentTx, { onRobinhood: false, readBalances: reader })).toBe("pay");
    expect(reader).not.toHaveBeenCalled();
  });
});
