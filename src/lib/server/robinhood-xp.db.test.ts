import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setSqlClient, type SqlClient } from "./db";
import { makeTestDb } from "./pglite-test-db";
import { getOrCreateUser } from "./accounts";
import { payRobinhoodSell, robinhoodPourXp } from "./robinhood-xp";
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
  await sql.query("delete from no_xp_intents");
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
    wallet = WALLET,
  }: { direction?: "buy" | "sell"; chain?: "robinhood" | "sonic"; quantity?: string | null; at?: string; listing?: string; wallet?: string } = {},
): Promise<string> {
  const intentTx = tx();
  await sql.query(
    `insert into orders (user_id, wallet_address, intent_tx, direction, listing_symbol, listing_address, quantity, placed_at, delivered_to, holding_chain)
     values ($1, $9, $2, $3, 'NVDA', $4, $5, $6::timestamptz, $7, $8)`,
    [userId, intentTx, direction, listing, quantity, at, wallet, chain, wallet],
  );
  return intentTx;
}

const xpOf = async (intentTx: string) =>
  ((await sql.query(`select count(*)::int as n from xp_events where ref = $1`, [intentTx])) as { n: number }[])[0].n;

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

  it("earns when the person sold it from that wallet before its balance was read (review XP: a quick sell)", async () => {
    const id = await user();
    const buy = await order(id, { quantity: "1", at: "2026-10-01T10:00:00Z" });
    // Sold back the same hour: the wallet holds nothing, the sell's spend proves the arrival.
    await order(id, { direction: "sell", quantity: "1", at: "2026-10-01T11:00:00Z" });
    expect(await robinhoodPourXp(buy, { onRobinhood: true, readBalances: holding(0n) })).toBe("pay");
  });

  it("adds a partial sell to what is left in the wallet", async () => {
    const id = await user();
    const buy = await order(id, { quantity: "1", at: "2026-10-01T10:00:00Z" });
    await order(id, { direction: "sell", quantity: "0.4", at: "2026-10-01T11:00:00Z" });
    expect(await robinhoodPourXp(buy, { onRobinhood: true, readBalances: holding((6n * ONE) / 10n) })).toBe("pay");
    expect(await robinhoodPourXp(buy, { onRobinhood: true, readBalances: holding((5n * ONE) / 10n) })).toBe("wait");
  });

  it("never counts a sell placed before the buy, from another wallet, of another listing or of another account", async () => {
    const id = await user();
    const other = (await getOrCreateUser({ did: null, wallet: "0x00000000000000000000000000000000000000cc" }))!.user.id;
    await order(id, { direction: "sell", quantity: "1", at: "2026-10-01T09:00:00Z" });
    const buy = await order(id, { quantity: "1", at: "2026-10-01T10:00:00Z" });
    await order(id, { direction: "sell", quantity: "1", at: "2026-10-01T11:00:00Z", wallet: "0x00000000000000000000000000000000000000bb" });
    await order(id, { direction: "sell", quantity: "1", at: "2026-10-01T11:00:00Z", listing: "0x00000000000000000000000000000000000000dd" });
    await order(other, { direction: "sell", quantity: "1", at: "2026-10-01T11:00:00Z" });
    await order(id, { direction: "sell", chain: "sonic", quantity: "1", at: "2026-10-01T11:00:00Z" });
    expect(await robinhoodPourXp(buy, { onRobinhood: true, readBalances: holding(0n) })).toBe("wait");
  });

  it("never lets one sell prove two buys: a later buy there is taken as what the sell spent", async () => {
    const id = await user();
    const first = await order(id, { quantity: "1", at: "2026-10-01T10:00:00Z" });
    const second = await order(id, { quantity: "1", at: "2026-10-01T10:30:00Z" });
    await order(id, { direction: "sell", quantity: "1", at: "2026-10-01T11:00:00Z" });
    // One sold, nothing left: the later buy's sale proves only the later buy.
    expect(await robinhoodPourXp(second, { onRobinhood: true, readBalances: holding(0n) })).toBe("pay");
    expect(await robinhoodPourXp(first, { onRobinhood: true, readBalances: holding(0n) })).toBe("wait");
    // Both sold: both proven.
    await order(id, { direction: "sell", quantity: "1", at: "2026-10-01T12:00:00Z" });
    expect(await robinhoodPourXp(first, { onRobinhood: true, readBalances: holding(0n) })).toBe("pay");
  });

  it("waits while a later buy there has no quantity yet", async () => {
    const id = await user();
    const buy = await order(id, { quantity: "1", at: "2026-10-01T10:00:00Z" });
    await order(id, { quantity: null, at: "2026-10-01T10:30:00Z" });
    await order(id, { direction: "sell", quantity: "5", at: "2026-10-01T11:00:00Z" });
    expect(await robinhoodPourXp(buy, { onRobinhood: true, readBalances: holding(0n) })).toBe("wait");
  });

  it("leaves a hub order alone, whatever Robinhood Chain says", async () => {
    const intentTx = await order(await user(), { chain: "sonic" });
    const reader = holding(0n);
    expect(await robinhoodPourXp(intentTx, { onRobinhood: false, readBalances: reader })).toBe("pay");
    expect(reader).not.toHaveBeenCalled();
  });
});

describe("a sell from Robinhood Chain (D2)", () => {
  const pay = (intentTx: string, userId: string) => payRobinhoodSell(intentTx, { userId });

  it("earns nothing for tokens Berth never delivered there", async () => {
    const id = await user();
    const sell = await order(id, { direction: "sell", quantity: "0.5" });
    expect((await pay(sell, id)).verdict).toBe("never");
    expect(await xpOf(sell)).toBe(0);
  });

  it("earns up to the Berth buys delivered there before it, beside every other sell that was paid, and pays a replay nothing more", async () => {
    const id = await user();
    await order(id, { quantity: "1", at: "2026-10-01T10:00:00Z" });
    const first = await order(id, { direction: "sell", quantity: "0.6", at: "2026-10-02T10:00:00Z" });
    expect(await pay(first, id)).toMatchObject({ verdict: "paid", awarded: 100 });
    expect(await pay(first, id)).toMatchObject({ verdict: "paid", awarded: 0 });
    const second = await order(id, { direction: "sell", quantity: "0.6", at: "2026-10-03T10:00:00Z" });
    expect((await pay(second, id)).verdict).toBe("never");
    const third = await order(id, { direction: "sell", quantity: "0.4", at: "2026-10-04T10:00:00Z" });
    expect((await pay(third, id)).verdict).toBe("paid");
  });

  it("counts a paid sell placed later against an earlier one reported after it (rh-delta)", async () => {
    const id = await user();
    await order(id, { quantity: "10", at: "2026-10-01T10:00:00Z" });
    const earlier = await order(id, { direction: "sell", quantity: "10", at: "2026-10-02T10:00:00Z" });
    const later = await order(id, { direction: "sell", quantity: "10", at: "2026-10-03T10:00:00Z" });
    expect((await pay(later, id)).verdict).toBe("paid");
    expect((await pay(earlier, id)).verdict).toBe("never");
  });

  it("pays sells reported at once only as far as the buys reach, one after another", async () => {
    const id = await user();
    await order(id, { quantity: "1", at: "2026-10-01T10:00:00Z" });
    const sells = await Promise.all([1, 2, 3].map((n) => order(id, { direction: "sell", quantity: "0.5", at: `2026-10-0${n + 1}T10:00:00Z` })));
    const verdicts = await Promise.all(sells.map((sell) => pay(sell, id)));
    expect(verdicts.filter((verdict) => verdict.verdict === "paid")).toHaveLength(2);
  });

  it("waits while a Berth buy there has no quantity yet, and never counts a no XP buy, a later buy, a hub buy or another listing's", async () => {
    const id = await user();
    const unread = await order(id, { quantity: null, at: "2026-10-01T10:00:00Z" });
    const sell = await order(id, { direction: "sell", quantity: "1", at: "2026-10-02T10:00:00Z" });
    expect((await pay(sell, id)).verdict).toBe("wait");
    // Judged under the lock: a wait, nothing paid, never a no (rh-final 2).
    expect(await xpOf(sell)).toBe(0);
    await order(id, { quantity: "0.5", at: "2026-10-01T09:00:00Z" });
    expect((await pay(sell, id)).verdict).toBe("wait");
    await sql.query(`delete from orders where quantity = 0.5`);
    await sql.query(`insert into no_xp_intents (intent_tx, reason) values ($1, 'delivery_refused')`, [unread]);
    const noXp = await order(id, { quantity: "5", at: "2026-10-01T11:00:00Z" });
    await sql.query(`insert into no_xp_intents (intent_tx, reason) values ($1, 'delivery_refused')`, [noXp]);
    await order(id, { quantity: "5", at: "2026-10-03T10:00:00Z" });
    await order(id, { quantity: "5", chain: "sonic", at: "2026-10-01T10:00:00Z" });
    await order(id, { quantity: "5", at: "2026-10-01T10:00:00Z", listing: "0x00000000000000000000000000000000000000ff" });
    expect((await pay(sell, id)).verdict).toBe("never");
  });
});
