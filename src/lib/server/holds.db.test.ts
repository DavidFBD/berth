import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setSqlClient, type SqlClient } from "./db";
import { makeTestDb } from "./pglite-test-db";
import { flushUnannounced, getOrCreateUser, type UserRow } from "./accounts";
import {
  holdCandidates,
  judgeHold,
  pendingHolds,
  runHoldCheck,
  type BalanceQuery,
  type BalanceReader,
} from "./holds";
import { getSodax } from "./pour-verify";
import { TOKEN_LISTINGS } from "@/lib/listings";
import { XP_ACTIONS } from "@/lib/xp";

/**
 * The thirty day hold check against a real Postgres with the real schema:
 * the candidate query's boundary arithmetic, the stamp that makes a verdict
 * final, the unannounced award, cumulative accounting per listing, and the
 * retry that never pays or forfeits on doubt.
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

const NOW = new Date("2026-09-24T06:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);
const NVDA = TOKEN_LISTINGS.find((listing) => listing.symbol === "NVDA")!;
const SGOV = TOKEN_LISTINGS.find((listing) => listing.symbol === "SGOV")!;
const ONE = 10n ** 18n;
/** A real vault from the SDK registry the cron reads, so the scope is the real one. */
const VAULT = getSodax().leverageYield.listVaults()[0]!.vault;

let seq = 0;
const tx = () => `0x${String(++seq).padStart(64, "0")}`;
const wallet = (n: number) => `0x${String(n).padStart(40, "0")}`;
/** The hub wallet a buy was delivered to: distinct from the paying wallet. */
const hub = (n: number) => `0x${"a".repeat(8)}${String(n).padStart(32, "0")}`;

async function account(n: number): Promise<UserRow> {
  return (await getOrCreateUser({ did: null, wallet: wallet(n) }))!.user;
}

async function order({
  owner,
  userId = null,
  direction = "buy",
  listing = NVDA.address,
  quantity = "1.5",
  filledAt = daysAgo(31),
  placedAt = null,
  deliveredTo,
}: {
  owner: string;
  userId?: string | null;
  direction?: "buy" | "sell";
  listing?: string;
  quantity?: string | null;
  filledAt?: Date | null;
  placedAt?: Date | null;
  /** Defaults to a hub wallet derived from the owner; pass null for none. */
  deliveredTo?: string | null;
}): Promise<string> {
  const intentTx = tx();
  const delivered =
    deliveredTo === undefined ? hub(Number.parseInt(owner.slice(2), 16)) : deliveredTo;
  await sql.query(
    `insert into orders (user_id, wallet_address, intent_tx, direction, listing_symbol,
       listing_address, quantity, placed_at, filled_at, delivered_to)
     values ($1, $2, $3, $4, 'X', $5, $6, $7, $8, $9)`,
    [userId, owner, intentTx, direction, listing, quantity, placedAt, filledAt, delivered],
  );
  return intentTx;
}

const deliveredOf = async (intentTx: string) =>
  (
    (await sql.query("select delivered_to from orders where intent_tx = $1", [intentTx])) as {
      delivered_to: string;
    }[]
  )[0].delivered_to;

/** A chain that answers every read with the same balance, and records the ask. */
function chain(balance: bigint | null): BalanceReader & { calls: BalanceQuery[][] } {
  const calls: BalanceQuery[][] = [];
  const reader = (async (queries: readonly BalanceQuery[]) => {
    calls.push([...queries]);
    return queries.map(() => balance);
  }) as BalanceReader & { calls: BalanceQuery[][] };
  reader.calls = calls;
  return reader;
}

async function orderRow(intentTx: string) {
  const rows = (await sql.query(
    "select hold_checked_at, hold_outcome from orders where intent_tx = $1",
    [intentTx],
  )) as { hold_checked_at: Date | null; hold_outcome: string | null }[];
  return rows[0];
}

async function xpOf(userId: string): Promise<number> {
  const rows = (await sql.query("select xp from users where id = $1", [userId])) as {
    xp: number;
  }[];
  return rows[0].xp;
}

describe("judgeHold", () => {
  it("pays at exactly the quantity, forfeits a wei short, retries on unknown", () => {
    expect(judgeHold("1.5", (ONE * 3n) / 2n)).toBe("paid");
    expect(judgeHold("1.5", (ONE * 3n) / 2n - 1n)).toBe("forfeit");
    expect(judgeHold("1.5", null)).toBe("retry");
    expect(judgeHold("0.018910000000000000", 18_910_000_000_000_000n)).toBe("paid");
  });

  it("counts what was already paid for against the balance", () => {
    expect(judgeHold("1", 2n * ONE, ONE)).toBe("paid");
    expect(judgeHold("1", 2n * ONE - 1n, ONE)).toBe("forfeit");
  });
});

describe("holdCandidates", () => {
  it("takes a buy at exactly thirty days and not a second sooner", async () => {
    const owner = await account(1);
    const due = await order({ owner: owner.wallet_address!, filledAt: daysAgo(30) });
    await order({
      owner: owner.wallet_address!,
      filledAt: new Date(daysAgo(30).getTime() + 1000),
    });
    const found = await holdCandidates(NOW);
    expect(found.map((candidate) => candidate.intentTx)).toEqual([due]);
  });

  it("counts from the placement when the fill time is unknown", async () => {
    const owner = await account(2);
    const placed = await order({
      owner: owner.wallet_address!,
      filledAt: null,
      placedAt: daysAgo(40),
    });
    const found = await holdCandidates(NOW);
    expect(found.map((candidate) => candidate.intentTx)).toEqual([placed]);
  });

  it("takes filled, unchecked, delivered buys with an owner, and nothing else", async () => {
    const owner = await account(3);
    const buy = await order({ owner: owner.wallet_address! });
    await order({ owner: owner.wallet_address!, direction: "sell" });
    await order({ owner: owner.wallet_address!, quantity: null });
    await order({ owner: owner.wallet_address!, deliveredTo: null });
    const checked = await order({ owner: owner.wallet_address! });
    await sql.query(
      "update orders set hold_checked_at = now(), hold_outcome = 'forfeit' where intent_tx = $1",
      [checked],
    );
    await order({ owner: wallet(999) }); // no account for this wallet
    const found = await holdCandidates(NOW);
    expect(found.map((candidate) => candidate.intentTx)).toEqual([buy]);
    expect(found[0]).toMatchObject({
      userId: owner.id,
      deliveredTo: await deliveredOf(buy),
      listingAddress: NVDA.address,
      quantity: "1.5",
      paidBefore: "0",
    });
  });

  it("belongs to the account that placed it, not whoever owns the paying wallet", async () => {
    const placer = await account(5);
    const walletOwner = await account(6);
    const intentTx = await order({ owner: walletOwner.wallet_address!, userId: placer.id });
    const found = await holdCandidates(NOW);
    expect(found.map((candidate) => [candidate.intentTx, candidate.userId])).toEqual([
      [intentTx, placer.id],
    ]);
  });

  it("walks oldest first and stops at the cap", async () => {
    const owner = await account(4);
    const newer = await order({ owner: owner.wallet_address!, filledAt: daysAgo(31) });
    const oldest = await order({ owner: owner.wallet_address!, filledAt: daysAgo(60) });
    const middle = await order({ owner: owner.wallet_address!, filledAt: daysAgo(45) });
    expect((await holdCandidates(NOW)).map((candidate) => candidate.intentTx)).toEqual([
      oldest,
      middle,
      newer,
    ]);
    expect((await holdCandidates(NOW, 2)).map((candidate) => candidate.intentTx)).toEqual([
      oldest,
      middle,
    ]);
  });
});

describe("runHoldCheck", () => {
  it("pays a held buy unannounced, and the next look flushes it", async () => {
    const owner = await account(10);
    const intentTx = await order({ owner: owner.wallet_address!, quantity: "1.5" });
    const reader = chain(2n * ONE);

    const summary = await runHoldCheck({ now: NOW, readBalances: reader });

    expect(summary).toEqual({ checked: 1, paid: 1, forfeited: 0, retried: 0 });
    // Read at the wallet the buy was delivered to, nowhere else.
    expect(reader.calls).toEqual([[{ holder: await deliveredOf(intentTx), listing: NVDA.address }]]);
    expect(await orderRow(intentTx)).toMatchObject({ hold_outcome: "paid" });
    expect((await orderRow(intentTx)).hold_checked_at).not.toBeNull();
    expect(await xpOf(owner.id)).toBe(owner.xp + XP_ACTIONS.held_30_days.amount);

    const events = (await sql.query(
      "select ref, announced from xp_events where user_id = $1 and kind = 'held_30_days'",
      [owner.id],
    )) as { ref: string; announced: boolean }[];
    expect(events).toEqual([{ ref: intentTx, announced: false }]);

    expect(await flushUnannounced(owner.id)).toEqual([
      { kind: "held_30_days", amount: XP_ACTIONS.held_30_days.amount },
    ]);
    expect(await flushUnannounced(owner.id)).toEqual([]);
  });

  it("pays the account that placed the order", async () => {
    const placer = await account(18);
    const walletOwner = await account(19);
    await order({ owner: walletOwner.wallet_address!, userId: placer.id });

    await runHoldCheck({ now: NOW, readBalances: chain(10n * ONE) });

    expect(await xpOf(placer.id)).toBe(placer.xp + XP_ACTIONS.held_30_days.amount);
    expect(await xpOf(walletOwner.id)).toBe(walletOwner.xp);
  });

  it("forfeits a sold buy, pays nothing, and never looks again", async () => {
    const owner = await account(11);
    const intentTx = await order({ owner: owner.wallet_address!, quantity: "1.5" });

    const first = await runHoldCheck({ now: NOW, readBalances: chain(ONE) });
    expect(first).toEqual({ checked: 1, paid: 0, forfeited: 1, retried: 0 });
    expect(await orderRow(intentTx)).toMatchObject({ hold_outcome: "forfeit" });
    expect(await xpOf(owner.id)).toBe(owner.xp);

    // Bought back since: too late, the verdict is final.
    const reader = chain(10n * ONE);
    const second = await runHoldCheck({ now: NOW, readBalances: reader });
    expect(second).toEqual({ checked: 0, paid: 0, forfeited: 0, retried: 0 });
    expect(reader.calls).toEqual([]);
    expect(await xpOf(owner.id)).toBe(owner.xp);
  });

  it("stamps 'paid', never 'forfeit', when the reward is already in the ledger", async () => {
    const owner = await account(24);
    const intentTx = await order({ owner: owner.wallet_address!, quantity: "1.5" });
    // An earlier run paid and then failed to stamp; today the balance is short.
    await sql.query(
      `insert into xp_events (user_id, kind, amount, ref, announced)
       values ($1, 'held_30_days', $2, $3, false)`,
      [owner.id, XP_ACTIONS.held_30_days.amount, intentTx],
    );

    const summary = await runHoldCheck({ now: NOW, readBalances: chain(0n) });

    expect(summary).toEqual({ checked: 1, paid: 1, forfeited: 0, retried: 0 });
    expect(await orderRow(intentTx)).toMatchObject({ hold_outcome: "paid" });
  });

  it("leaves every row for tomorrow when the chain cannot be read", async () => {
    const owner = await account(12);
    const intentTx = await order({ owner: owner.wallet_address! });
    const broken: BalanceReader = async () => {
      throw new Error("rpc down");
    };

    const summary = await runHoldCheck({ now: NOW, readBalances: broken });

    expect(summary).toEqual({ checked: 1, paid: 0, forfeited: 0, retried: 1 });
    expect(await orderRow(intentTx)).toEqual({ hold_checked_at: null, hold_outcome: null });
    expect(await xpOf(owner.id)).toBe(owner.xp);

    const retry = await runHoldCheck({ now: NOW, readBalances: chain(10n * ONE) });
    expect(retry).toEqual({ checked: 1, paid: 1, forfeited: 0, retried: 0 });
  });

  it("retries only the reads that failed inside a good batch", async () => {
    const owner = await account(13);
    const stock = await order({ owner: owner.wallet_address!, listing: NVDA.address });
    const cash = await order({
      owner: owner.wallet_address!,
      listing: SGOV.address,
      filledAt: daysAgo(35),
    });
    const partial: BalanceReader = async (queries) =>
      queries.map((query) => (query.listing === SGOV.address ? null : 5n * ONE));

    const summary = await runHoldCheck({ now: NOW, readBalances: partial });

    expect(summary).toEqual({ checked: 2, paid: 1, forfeited: 0, retried: 1 });
    expect(await orderRow(stock)).toMatchObject({ hold_outcome: "paid" });
    expect(await orderRow(cash)).toEqual({ hold_checked_at: null, hold_outcome: null });
  });

  it("moves a row that always fails behind a fresh one", async () => {
    const owner = await account(25);
    const stuck = await order({
      owner: owner.wallet_address!,
      listing: SGOV.address,
      filledAt: daysAgo(60),
    });
    const failing: BalanceReader = async (queries) =>
      queries.map((query) => (query.listing === SGOV.address ? null : 5n * ONE));

    await runHoldCheck({ now: NOW, readBalances: failing, limit: 1 });
    const fresh = await order({ owner: owner.wallet_address!, filledAt: daysAgo(31) });

    expect((await holdCandidates(NOW, 1)).map((candidate) => candidate.intentTx)).toEqual([
      fresh,
    ]);
    const second = await runHoldCheck({ now: NOW, readBalances: failing, limit: 1 });
    expect(second).toEqual({ checked: 1, paid: 1, forfeited: 0, retried: 0 });
    expect(await orderRow(fresh)).toMatchObject({ hold_outcome: "paid" });
    expect(await orderRow(stuck)).toEqual({ hold_checked_at: null, hold_outcome: null });
  });

  it("pays once however many times it runs", async () => {
    const owner = await account(14);
    await order({ owner: owner.wallet_address! });
    const reader = chain(10n * ONE);

    await runHoldCheck({ now: NOW, readBalances: reader });
    const again = await runHoldCheck({ now: NOW, readBalances: reader });

    expect(again).toEqual({ checked: 0, paid: 0, forfeited: 0, retried: 0 });
    expect(reader.calls).toHaveLength(1);
    expect(await xpOf(owner.id)).toBe(owner.xp + XP_ACTIONS.held_30_days.amount);
  });

  it("pays two 1 unit buys of one listing once when only 1 is held", async () => {
    const owner = await account(15);
    const older = await order({ owner: owner.wallet_address!, quantity: "1", filledAt: daysAgo(40) });
    const newer = await order({ owner: owner.wallet_address!, quantity: "1", filledAt: daysAgo(35) });
    const reader = chain(ONE);

    const summary = await runHoldCheck({ now: NOW, readBalances: reader });

    expect(summary).toEqual({ checked: 2, paid: 1, forfeited: 1, retried: 0 });
    expect(reader.calls[0]).toHaveLength(1); // one read for the shared listing and wallet
    expect(await orderRow(older)).toMatchObject({ hold_outcome: "paid" });
    expect(await orderRow(newer)).toMatchObject({ hold_outcome: "forfeit" });
    expect(await xpOf(owner.id)).toBe(owner.xp + XP_ACTIONS.held_30_days.amount);
  });

  it("counts buys paid on an earlier run against a later one", async () => {
    const owner = await account(26);
    await order({ owner: owner.wallet_address!, quantity: "1", filledAt: daysAgo(40) });
    await runHoldCheck({ now: NOW, readBalances: chain(ONE) });

    const short = await order({ owner: owner.wallet_address!, quantity: "1", filledAt: daysAgo(31) });
    expect(await runHoldCheck({ now: NOW, readBalances: chain(ONE) })).toEqual({
      checked: 1,
      paid: 0,
      forfeited: 1,
      retried: 0,
    });
    expect(await orderRow(short)).toMatchObject({ hold_outcome: "forfeit" });

    const covered = await order({ owner: owner.wallet_address!, quantity: "1", filledAt: daysAgo(30) });
    expect(await runHoldCheck({ now: NOW, readBalances: chain(2n * ONE) })).toMatchObject({
      paid: 1,
    });
    expect(await orderRow(covered)).toMatchObject({ hold_outcome: "paid" });
  });

  it("never judges a buy with no delivery wallet, or a listing nobody knows", async () => {
    const owner = await account(17);
    const undelivered = await order({ owner: owner.wallet_address!, deliveredTo: null });
    const unknown = await order({
      owner: owner.wallet_address!,
      listing: "0x000000000000000000000000000000000000dEaD",
    });
    const reader = chain(0n);

    const summary = await runHoldCheck({ now: NOW, readBalances: reader });

    expect(summary).toEqual({ checked: 0, paid: 0, forfeited: 0, retried: 0 });
    expect(reader.calls).toEqual([]);
    for (const intentTx of [undelivered, unknown]) {
      expect(await orderRow(intentTx)).toEqual({ hold_checked_at: null, hold_outcome: null });
    }
  });
});

describe("pendingHolds", () => {
  it("lists the account's unchecked filled buys, soonest due first", async () => {
    const owner = await account(20);
    const other = await account(21);
    const later = await order({ owner: owner.wallet_address!, filledAt: daysAgo(3) });
    const sooner = await order({
      owner: owner.wallet_address!,
      listing: VAULT,
      filledAt: null,
      placedAt: daysAgo(10),
    });
    await order({ owner: owner.wallet_address!, direction: "sell", filledAt: daysAgo(20) });
    await order({ owner: owner.wallet_address!, quantity: null, filledAt: daysAgo(20) });
    const done = await order({ owner: owner.wallet_address!, filledAt: daysAgo(50) });
    await sql.query(
      "update orders set hold_checked_at = now(), hold_outcome = 'paid' where intent_tx = $1",
      [done],
    );
    await order({ owner: other.wallet_address!, filledAt: daysAgo(5) });

    const holds = await pendingHolds(owner.id);

    expect(holds).toEqual([
      {
        ref: sooner,
        pouredAt: daysAgo(10).toISOString(),
        dueAt: daysAgo(-20).toISOString(),
        amount: XP_ACTIONS.held_30_days.amount,
        name: null,
      },
      {
        ref: later,
        pouredAt: daysAgo(3).toISOString(),
        dueAt: daysAgo(-27).toISOString(),
        amount: XP_ACTIONS.held_30_days.amount,
        name: NVDA.name,
      },
    ]);
  });

  it("leaves out a buy with no delivery wallet, since no verdict is coming", async () => {
    const owner = await account(23);
    await order({ owner: owner.wallet_address!, deliveredTo: null, filledAt: daysAgo(40) });
    await order({
      owner: owner.wallet_address!,
      listing: "0x000000000000000000000000000000000000dEaD",
      filledAt: daysAgo(5),
    });
    const listed = await order({ owner: owner.wallet_address!, filledAt: daysAgo(3) });

    expect((await pendingHolds(owner.id)).map((hold) => hold.ref)).toEqual([listed]);
  });

  it("is empty for an account with no buys", async () => {
    const owner = await account(22);
    expect(await pendingHolds(owner.id)).toEqual([]);
  });
});
