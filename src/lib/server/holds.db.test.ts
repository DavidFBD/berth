import { readFileSync } from "node:fs";
import { join } from "node:path";
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
  holdingChain = null,
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
  /** orders.holding_chain: null (every row before Robinhood Chain delivery), 'sonic' or 'robinhood'. */
  holdingChain?: "sonic" | "robinhood" | null;
}): Promise<string> {
  const intentTx = tx();
  const delivered =
    deliveredTo === undefined ? hub(Number.parseInt(owner.slice(2), 16)) : deliveredTo;
  await sql.query(
    `insert into orders (user_id, wallet_address, intent_tx, direction, listing_symbol,
       listing_address, quantity, placed_at, filled_at, delivered_to, holding_chain)
     values ($1, $2, $3, $4, 'X', $5, $6, $7, $8, $9, $10)`,
    [userId, owner, intentTx, direction, listing, quantity, placedAt, filledAt, delivered, holdingChain],
  );
  return intentTx;
}

const deliveredOf = async (intentTx: string) =>
  (
    (await sql.query("select delivered_to from orders where intent_tx = $1", [intentTx])) as {
      delivered_to: string;
    }[]
  )[0].delivered_to;

/** No linked address derives a hub wallet here: the hub holding is each buy's own delivery wallet, as before. */
const noHubs = async () => [] as string[];

/** A chain that answers every hub read with the same balance (nothing on Robinhood Chain), and records the ask. */
function chain(balance: bigint | null): BalanceReader & { calls: BalanceQuery[][] } {
  const calls: BalanceQuery[][] = [];
  const reader = (async (queries: readonly BalanceQuery[]) => {
    calls.push([...queries]);
    return queries.map((query) => (query.chain === "robinhood" ? 0n : balance));
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

    const summary = await runHoldCheck({ now: NOW, hubWalletsOf: noHubs, readBalances: reader });

    expect(summary).toEqual({ checked: 1, paid: 1, forfeited: 0, retried: 0 });
    // Read at the wallet the buy was delivered to, nowhere else.
    // At the wallet the buy was delivered to on the hub, and (ACCOUNT_WIDE) the account's wallet on Robinhood Chain.
    expect(reader.calls).toEqual([
      [
        { holder: await deliveredOf(intentTx), listing: NVDA.address, chain: "sonic" },
        { holder: owner.wallet_address, listing: NVDA.address, chain: "robinhood" },
      ],
    ]);
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

  it("judges nothing past its deadline, and leaves the buy for the next run", async () => {
    const owner = await account(31);
    const intentTx = await order({ owner: owner.wallet_address! });
    await runHoldCheck({ now: NOW, hubWalletsOf: noHubs, readBalances: chain(10n * ONE), deadline: Date.now() - 1 });
    expect(await orderRow(intentTx)).toMatchObject({ hold_outcome: null });
    await runHoldCheck({ now: NOW, hubWalletsOf: noHubs, readBalances: chain(10n * ONE) });
    expect(await orderRow(intentTx)).toMatchObject({ hold_outcome: "paid" });
  });

  it("pays the account that placed the order", async () => {
    const placer = await account(18);
    const walletOwner = await account(19);
    await order({ owner: walletOwner.wallet_address!, userId: placer.id });

    await runHoldCheck({ now: NOW, hubWalletsOf: noHubs, readBalances: chain(10n * ONE) });

    expect(await xpOf(placer.id)).toBe(placer.xp + XP_ACTIONS.held_30_days.amount);
    expect(await xpOf(walletOwner.id)).toBe(walletOwner.xp);
  });

  it("forfeits a sold buy, pays nothing, and never looks again", async () => {
    const owner = await account(11);
    const intentTx = await order({ owner: owner.wallet_address!, quantity: "1.5" });

    const first = await runHoldCheck({ now: NOW, hubWalletsOf: noHubs, readBalances: chain(ONE) });
    expect(first).toEqual({ checked: 1, paid: 0, forfeited: 1, retried: 0 });
    expect(await orderRow(intentTx)).toMatchObject({ hold_outcome: "forfeit" });
    expect(await xpOf(owner.id)).toBe(owner.xp);

    // Bought back since: too late, the verdict is final.
    const reader = chain(10n * ONE);
    const second = await runHoldCheck({ now: NOW, hubWalletsOf: noHubs, readBalances: reader });
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

    const summary = await runHoldCheck({ now: NOW, hubWalletsOf: noHubs, readBalances: chain(0n) });

    expect(summary).toEqual({ checked: 1, paid: 1, forfeited: 0, retried: 0 });
    expect(await orderRow(intentTx)).toMatchObject({ hold_outcome: "paid" });
  });

  it("leaves every row for tomorrow when the chain cannot be read", async () => {
    const owner = await account(12);
    const intentTx = await order({ owner: owner.wallet_address! });
    const broken: BalanceReader = async () => {
      throw new Error("rpc down");
    };

    const summary = await runHoldCheck({ now: NOW, hubWalletsOf: noHubs, readBalances: broken });

    expect(summary).toEqual({ checked: 1, paid: 0, forfeited: 0, retried: 1 });
    expect(await orderRow(intentTx)).toEqual({ hold_checked_at: null, hold_outcome: null });
    expect(await xpOf(owner.id)).toBe(owner.xp);

    const retry = await runHoldCheck({ now: NOW, hubWalletsOf: noHubs, readBalances: chain(10n * ONE) });
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

    const summary = await runHoldCheck({ now: NOW, hubWalletsOf: noHubs, readBalances: partial });

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

    await runHoldCheck({ now: NOW, hubWalletsOf: noHubs, readBalances: failing, limit: 1 });
    const fresh = await order({ owner: owner.wallet_address!, filledAt: daysAgo(31) });

    expect((await holdCandidates(NOW, 1)).map((candidate) => candidate.intentTx)).toEqual([
      fresh,
    ]);
    const second = await runHoldCheck({ now: NOW, hubWalletsOf: noHubs, readBalances: failing, limit: 1 });
    expect(second).toEqual({ checked: 1, paid: 1, forfeited: 0, retried: 0 });
    expect(await orderRow(fresh)).toMatchObject({ hold_outcome: "paid" });
    expect(await orderRow(stuck)).toEqual({ hold_checked_at: null, hold_outcome: null });
  });

  it("pays once however many times it runs", async () => {
    const owner = await account(14);
    await order({ owner: owner.wallet_address! });
    const reader = chain(10n * ONE);

    await runHoldCheck({ now: NOW, hubWalletsOf: noHubs, readBalances: reader });
    const again = await runHoldCheck({ now: NOW, hubWalletsOf: noHubs, readBalances: reader });

    expect(again).toEqual({ checked: 0, paid: 0, forfeited: 0, retried: 0 });
    expect(reader.calls).toHaveLength(1);
    expect(await xpOf(owner.id)).toBe(owner.xp + XP_ACTIONS.held_30_days.amount);
  });

  it("pays two 1 unit buys of one listing once when only 1 is held", async () => {
    const owner = await account(15);
    const older = await order({ owner: owner.wallet_address!, quantity: "1", filledAt: daysAgo(40) });
    const newer = await order({ owner: owner.wallet_address!, quantity: "1", filledAt: daysAgo(35) });
    const reader = chain(ONE);

    const summary = await runHoldCheck({ now: NOW, hubWalletsOf: noHubs, readBalances: reader });

    expect(summary).toEqual({ checked: 2, paid: 1, forfeited: 1, retried: 0 });
    // One read for the shared listing and wallet on the hub, one for the account's wallet on Robinhood Chain.
    expect(reader.calls[0].filter((query) => query.chain === "sonic")).toHaveLength(1);
    expect(await orderRow(older)).toMatchObject({ hold_outcome: "paid" });
    expect(await orderRow(newer)).toMatchObject({ hold_outcome: "forfeit" });
    expect(await xpOf(owner.id)).toBe(owner.xp + XP_ACTIONS.held_30_days.amount);
  });

  it("counts buys paid on an earlier run against a later one", async () => {
    const owner = await account(26);
    await order({ owner: owner.wallet_address!, quantity: "1", filledAt: daysAgo(40) });
    await runHoldCheck({ now: NOW, hubWalletsOf: noHubs, readBalances: chain(ONE) });

    const short = await order({ owner: owner.wallet_address!, quantity: "1", filledAt: daysAgo(31) });
    expect(await runHoldCheck({ now: NOW, hubWalletsOf: noHubs, readBalances: chain(ONE) })).toEqual({
      checked: 1,
      paid: 0,
      forfeited: 1,
      retried: 0,
    });
    expect(await orderRow(short)).toMatchObject({ hold_outcome: "forfeit" });

    const covered = await order({ owner: owner.wallet_address!, quantity: "1", filledAt: daysAgo(30) });
    expect(await runHoldCheck({ now: NOW, hubWalletsOf: noHubs, readBalances: chain(2n * ONE) })).toMatchObject({
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

    const summary = await runHoldCheck({ now: NOW, hubWalletsOf: noHubs, readBalances: reader });

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

/**
 * A buy delivered to the person's own wallet on Robinhood Chain (plan
 * P1b): judged by the balance of the listing's token there, at the wallet
 * it was delivered to, never by the hub's record of the fill, so a
 * delivery that never arrived is never paid.
 */
describe("a buy delivered to Robinhood Chain", () => {
  /** A chain answering per chain: what the wallet holds on Robinhood Chain, and on the hub. */
  function twoChains(onRobinhood: bigint | null, onHub: bigint | null): BalanceReader & { calls: BalanceQuery[][] } {
    const calls: BalanceQuery[][] = [];
    const reader = (async (queries: readonly BalanceQuery[]) => {
      calls.push([...queries]);
      return queries.map((query) => (query.chain === "robinhood" ? onRobinhood : onHub));
    }) as BalanceReader & { calls: BalanceQuery[][] };
    reader.calls = calls;
    return reader;
  }

  it("is judged on Robinhood Chain at the wallet it was delivered to, and paid when it is still there", async () => {
    const owner = await account(40);
    const robinhood = await order({ owner: owner.wallet_address!, holdingChain: "robinhood", deliveredTo: owner.wallet_address!, filledAt: daysAgo(45) });

    expect((await holdCandidates(NOW)).map((candidate) => [candidate.intentTx, candidate.holdingChain])).toEqual([[robinhood, "robinhood"]]);
    const reader = twoChains(2n * ONE, 0n);
    expect(await runHoldCheck({ now: NOW, hubWalletsOf: noHubs, readBalances: reader })).toEqual({ checked: 1, paid: 1, forfeited: 0, retried: 0 });
    expect(reader.calls).toEqual([[{ holder: owner.wallet_address, listing: NVDA.address, chain: "robinhood" }]]);
    expect(await orderRow(robinhood)).toMatchObject({ hold_outcome: "paid" });
    expect(await xpOf(owner.id)).toBe(owner.xp + XP_ACTIONS.held_30_days.amount);
  });

  it("is never paid when the delivery is not in the wallet, whatever the hub's fill says", async () => {
    const owner = await account(41);
    const robinhood = await order({ owner: owner.wallet_address!, quantity: "1", holdingChain: "robinhood", deliveredTo: owner.wallet_address!, filledAt: daysAgo(31) });
    // The hub would cover it; Robinhood Chain, where it was delivered, holds nothing.
    expect(await runHoldCheck({ now: NOW, hubWalletsOf: noHubs, readBalances: twoChains(0n, 10n * ONE) })).toMatchObject({ paid: 0, forfeited: 1 });
    expect(await orderRow(robinhood)).toMatchObject({ hold_outcome: "forfeit" });
    expect(await xpOf(owner.id)).toBe(owner.xp);
  });

  it("waits a day when Robinhood Chain does not answer, for every buy of that listing, hub ones too (ACCOUNT_WIDE), and judges a vault as before", async () => {
    const owner = await account(42);
    const legacy = await order({ owner: owner.wallet_address!, quantity: "1", filledAt: daysAgo(33) });
    const robinhood = await order({ owner: owner.wallet_address!, quantity: "1", holdingChain: "robinhood", deliveredTo: owner.wallet_address!, filledAt: daysAgo(31) });
    const vault = await order({ owner: owner.wallet_address!, listing: VAULT, quantity: "1", filledAt: daysAgo(32) });
    expect(await runHoldCheck({ now: NOW, hubWalletsOf: noHubs, readBalances: twoChains(null, ONE) })).toEqual({ checked: 3, paid: 1, forfeited: 0, retried: 2 });
    expect(await orderRow(vault)).toMatchObject({ hold_outcome: "paid" });
    expect(await orderRow(legacy)).toMatchObject({ hold_checked_at: null, hold_outcome: null });
    expect(await orderRow(robinhood)).toMatchObject({ hold_checked_at: null, hold_outcome: null });
  });

  it("keeps each chain's paid amount to itself at the same wallet", async () => {
    const owner = await account(46);
    const at = owner.wallet_address!;
    const first = await order({ owner: at, quantity: "1", holdingChain: "robinhood", deliveredTo: at, filledAt: daysAgo(40) });
    await sql.query("update orders set hold_checked_at = $1, hold_outcome = 'paid' where intent_tx = $2", [daysAgo(5), first]);
    const second = await order({ owner: at, quantity: "1", holdingChain: "robinhood", deliveredTo: at, filledAt: daysAgo(31) });
    expect((await holdCandidates(NOW)).map((candidate) => [candidate.intentTx, candidate.paidBefore])).toEqual([[second, "1"]]);
    // One token there covers the first buy only.
    expect(await runHoldCheck({ now: NOW, hubWalletsOf: noHubs, readBalances: twoChains(ONE, 10n * ONE) })).toMatchObject({ paid: 0, forfeited: 1 });
  });

  it("judges the account's whole holding there, so tokens moved between its own wallets pay one buy once, never two (rh-server m2)", async () => {
    const owner = await account(49);
    const a = owner.wallet_address!;
    const b = wallet(4949);
    // The first buy went to A and was paid on its day 30.
    const first = await order({ owner: a, quantity: "1", holdingChain: "robinhood", deliveredTo: a, filledAt: daysAgo(40) });
    await sql.query("update orders set hold_checked_at = $1, hold_outcome = 'paid' where intent_tx = $2", [daysAgo(10), first]);
    // The second went to B; its tokens left, and A's one token was then moved to B.
    const second = await order({ owner: a, quantity: "1", holdingChain: "robinhood", deliveredTo: b, filledAt: daysAgo(31) });
    expect((await holdCandidates(NOW)).map((candidate) => [candidate.intentTx, candidate.paidBefore])).toEqual([[second, "1"]]);
    const asked: BalanceQuery[] = [];
    const moved: BalanceReader = async (queries) => {
      asked.push(...queries);
      return queries.map((query) => (query.holder === b ? ONE : 0n));
    };
    const summary = await runHoldCheck({ now: NOW, hubWalletsOf: noHubs, readBalances: moved, walletsOf: async () => [a, b] });
    expect(summary).toMatchObject({ paid: 0, forfeited: 1 });
    // Both of the account's wallets were read on Robinhood Chain.
    expect(asked.map((query) => [query.holder, query.chain]).sort()).toEqual([[a, "robinhood"], [b, "robinhood"]].sort());
    expect(await orderRow(second)).toMatchObject({ hold_outcome: "forfeit" });
  });

  it("pays a buy whose tokens moved to another of the account's wallets, and retries when the wallets cannot be read", async () => {
    const owner = await account(50);
    const a = owner.wallet_address!;
    const b = wallet(5050);
    const bought = await order({ owner: a, quantity: "1", holdingChain: "robinhood", deliveredTo: a, filledAt: daysAgo(31) });
    const atB: BalanceReader = async (queries) => queries.map((query) => (query.holder === b ? ONE : 0n));
    expect(
      await runHoldCheck({
        now: NOW,
        readBalances: atB,
        walletsOf: async () => {
          throw new Error("identities down");
        },
      }),
    ).toMatchObject({ retried: 1, paid: 0, forfeited: 0 });
    expect(await runHoldCheck({ now: NOW, hubWalletsOf: noHubs, readBalances: atB, walletsOf: async () => [a, b] })).toMatchObject({ paid: 1 });
    expect(await orderRow(bought)).toMatchObject({ hold_outcome: "paid" });
  });

  it("is listed as waiting beside the hub's buys", async () => {
    const owner = await account(47);
    const there = await order({ owner: owner.wallet_address!, holdingChain: "robinhood", deliveredTo: owner.wallet_address!, filledAt: daysAgo(3) });
    const listed = await order({ owner: owner.wallet_address!, filledAt: daysAgo(2) });
    expect((await pendingHolds(owner.id)).map((hold) => hold.ref)).toEqual([there, listed]);
  });

  it("is never judged or listed for a listing with no token on Robinhood Chain", async () => {
    const owner = await account(48);
    await order({ owner: owner.wallet_address!, listing: VAULT, holdingChain: "robinhood", deliveredTo: owner.wallet_address!, filledAt: daysAgo(40) });
    expect(await holdCandidates(NOW)).toEqual([]);
    expect(await pendingHolds(owner.id)).toEqual([]);
  });

  it("counts a lot paid on either chain toward a buy on the other, so one lot bridged back and forth pays once (rh-delta on 1e9a3d1)", async () => {
    const owner = await account(43);
    const a = owner.wallet_address!;
    const paidThere = await order({ owner: a, quantity: "1", holdingChain: "robinhood", deliveredTo: a, filledAt: daysAgo(60) });
    await sql.query("update orders set hold_checked_at = $1, hold_outcome = 'paid' where intent_tx = $2", [daysAgo(20), paidThere]);
    const onHub = await order({ owner: a, quantity: "1", filledAt: daysAgo(31) });
    expect((await holdCandidates(NOW)).map((candidate) => [candidate.intentTx, candidate.paidBefore])).toEqual([[onHub, "1"]]);
    // The one lot, bridged to the hub for this check: one held, two to cover.
    expect(await runHoldCheck({ now: NOW, hubWalletsOf: noHubs, readBalances: twoChains(0n, ONE) })).toMatchObject({ paid: 0, forfeited: 1 });
  });

  it("never lets a monthly buy and sell of the same amount ride on a paid lot (rh-final 1)", async () => {
    const owner = await account(46);
    const a = owner.wallet_address!;
    const lot = await order({ owner: a, quantity: "10", holdingChain: "robinhood", deliveredTo: a, filledAt: daysAgo(120) });
    await sql.query("update orders set hold_checked_at = $1, hold_outcome = 'paid' where intent_tx = $2", [daysAgo(90), lot]);
    // Month one: bought 10 and sold 10 at once; that buy was forfeited.
    const first = await order({ owner: a, quantity: "10", holdingChain: "robinhood", deliveredTo: a, filledAt: daysAgo(70) });
    await sql.query("update orders set hold_checked_at = $1, hold_outcome = 'forfeit' where intent_tx = $2", [daysAgo(40), first]);
    await order({ owner: a, userId: owner.id, direction: "sell", quantity: "10", filledAt: new Date(daysAgo(70).getTime() + 3_600_000) });
    // Month two: the same again; the paid lot of 10 is all that is held.
    const second = await order({ owner: a, quantity: "10", holdingChain: "robinhood", deliveredTo: a, filledAt: daysAgo(35) });
    await order({ owner: a, userId: owner.id, direction: "sell", quantity: "10", filledAt: new Date(daysAgo(35).getTime() + 3_600_000) });
    expect((await holdCandidates(NOW)).map((candidate) => [candidate.intentTx, candidate.paidBefore])).toEqual([[second, "10"]]);
    expect(await runHoldCheck({ now: NOW, hubWalletsOf: noHubs, readBalances: twoChains(10n * ONE, 0n) })).toMatchObject({ paid: 0, forfeited: 1 });
  });

  it("nets sells out of what was paid, so an honest holder who sold a paid lot never forfeits a new buy (rh-delta)", async () => {
    const owner = await account(44);
    const a = owner.wallet_address!;
    const paid = await order({ owner: a, quantity: "1", holdingChain: "robinhood", deliveredTo: a, filledAt: daysAgo(70) });
    await sql.query("update orders set hold_checked_at = $1, hold_outcome = 'paid' where intent_tx = $2", [daysAgo(40), paid]);
    await order({ owner: a, userId: owner.id, direction: "sell", quantity: "1", filledAt: daysAgo(35) });
    const fresh = await order({ owner: a, quantity: "1", holdingChain: "robinhood", deliveredTo: a, filledAt: daysAgo(31) });
    expect((await holdCandidates(NOW)).map((candidate) => [candidate.intentTx, candidate.paidBefore])).toEqual([[fresh, "0"]]);
    expect(await runHoldCheck({ now: NOW, hubWalletsOf: noHubs, readBalances: twoChains(ONE, 0n) })).toMatchObject({ paid: 1 });
  });

  it("reads Robinhood Chain only at wallets linked now, never a delivery wallet since unlinked", async () => {
    const owner = await account(45);
    const gone = wallet(4545);
    const bought = await order({ owner: owner.wallet_address!, quantity: "1", holdingChain: "robinhood", deliveredTo: gone, filledAt: daysAgo(31) });
    const asked: BalanceQuery[] = [];
    const atGone: BalanceReader = async (queries) => {
      asked.push(...queries);
      return queries.map((query) => (query.holder === gone ? ONE : 0n));
    };
    expect(await runHoldCheck({ now: NOW, hubWalletsOf: noHubs, readBalances: atGone, walletsOf: async () => [owner.wallet_address!] })).toMatchObject({
      forfeited: 1,
    });
    expect(asked.some((query) => query.holder === gone)).toBe(false);
    expect(await orderRow(bought)).toMatchObject({ hold_outcome: "forfeit" });
  });

  it("is refused by the schema under any chain name it does not know", async () => {
    const owner = await account(44);
    await expect(order({ owner: owner.wallet_address!, holdingChain: "base" as "sonic" })).rejects.toThrow();
  });

  it("keeps its check by name, and adds it again where the column came without one", async () => {
    const named = "select count(*)::int as n from pg_constraint where conrelid = 'orders'::regclass and conname = 'orders_holding_chain_check'";
    expect(await sql.query(named)).toEqual([{ n: 1 }]);
    // The column already there without its check (an earlier ALTER): the
    // schema's own statements, run again, put the check back exactly once.
    await sql.query("alter table orders drop constraint orders_holding_chain_check");
    const schema = readFileSync(join(process.cwd(), "db/schema.sql"), "utf8")
      .split(/;\s*\n/)
      .filter((statement) => statement.includes("holding_chain"));
    expect(schema).toHaveLength(2);
    for (let run = 0; run < 2; run += 1) for (const statement of schema) await sql.query(statement);
    expect(await sql.query(named)).toEqual([{ n: 1 }]);
    const owner = await account(45);
    await expect(order({ owner: owner.wallet_address!, holdingChain: "4663" as "sonic" })).rejects.toThrow();
  });
});
