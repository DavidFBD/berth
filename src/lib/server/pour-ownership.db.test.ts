import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setSqlClient, type SqlClient } from "./db";
import { makeTestDb } from "./pglite-test-db";
import { mergeAccounts } from "./account-merge";
import { INTENTS_CONTRACT, accountOwnedWallets, heldAt, judgeOwnership, type HubFunding } from "./pour-ownership";
import { payClaim, payRecordedClaim, savePourClaim, settlePourClaims, type ClaimPayDeps } from "./pour-claims";
import type { Intent } from "@sodax/sdk";
import { COUNTS_FOR_CAMPAIGNS, countsForCampaigns, isNoXp, markNoXp } from "./no-xp";

/**
 * The account's wallets as the ownership proof reads them, against the
 * real schema and the real merge, and a stranger's claim that the evening
 * pass refuses so the real owner can still report the intent.
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

const q = <T = Record<string, unknown>>(text: string, params: unknown[] = []) => sql.query(text, params) as Promise<T[]>;
const account = async (wallet: string | null, email: string | null = null) =>
  (await q<{ id: string }>(`insert into users (wallet_address, email) values ($1, $2) returning id`, [wallet, email]))[0].id;
const identity = (userId: string, value: string, family: string, proof: string, at: string, home = false) =>
  q(
    `insert into user_identities (user_id, kind, value, family, is_home, proof, created_at) values ($1, 'wallet', $2, $3, $4, $5, $6)`,
    [userId, value, family, home, proof, at],
  );

// The Solana fixture of lib/server/pour-ownership.test (SODAX's public orderbook).
const SOL = "2vCraXuVuBnHY5F8tPYEKG6s6Qb9aUjk3cpt4VKWKvvW";
const SOL_SRC = "0x1c7cdfc2e4e7745be1a2361d0513f60490fcd73c1a7df1993a896a1b37594ef3";
const SOL_CREATOR = "0x04edfda1b34481303689ab190e3240e75751a6f2";
const USDC_HUB = "0x29219dd400f2bf60e5a23d13be72b486d4038894";
const SPEND = { inputToken: USDC_HUB, inputAmount: 1_000n };
/** The hub transaction shows `payer` paying the intent's input into the Intents contract. */
const paidBy = (payer: string): HubFunding => ({
  txFrom: "0x695880381e2f947065fbbd65dce8bb309a4344c2",
  transfers: [{ token: USDC_HUB, from: payer.toLowerCase(), to: INTENTS_CONTRACT, value: 1_000n }],
});
const solanaBuy = (dstAddress: string) => ({ ...SPEND, creator: SOL_CREATOR, srcChain: 1n, srcAddress: SOL_SRC, dstChain: 146n, dstAddress });

/** What lib/server/account-wallets writes for a link, an unlink and a home change. */
const audit = (userId: string, action: string, detail: Record<string, unknown>, at: string) =>
  q(`insert into account_audit (user_id, action, detail, created_at) values ($1, $2, $3::jsonb, $4)`, [userId, action, JSON.stringify(detail), at]);

describe("accountOwnedWallets: the account's wallets as spans of time", () => {
  it("the home from the start, a linked wallet from when it joined, an unlinked one until it left, every family", async () => {
    const home = "0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1";
    const payFrom = "0xb2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2";
    const user = await account(home);
    await identity(user, `eip155:${home}`, "evm", "siwe", "2026-09-20T00:00:00Z", true);
    await identity(user, `solana:${SOL}`, "solana", "siws", "2026-09-22T00:00:00Z");
    await audit(user, "wallet_linked", { family: "solana", wallet: `solana:${SOL}`, home: false, proof: "siws" }, "2026-09-22T00:00:00Z");
    await identity(user, "bip122:bc1qxjjcjwmjapj25nupfelq0l94nlftpymfwfac84", "bitcoin", "bip322", "2026-09-23T00:00:00Z");
    await identity(user, `eip155:${payFrom}`, "evm", "siwe", "2026-09-24T00:00:00Z");
    await audit(user, "wallet_linked", { family: "evm", wallet: `eip155:${payFrom}`, home: false, proof: "siwe" }, "2026-09-24T00:00:00Z");
    await q(`update user_identities set unlinked_at = '2026-09-28T00:00:00Z' where value = $1`, [`eip155:${payFrom}`]);
    const wallets = await accountOwnedWallets(user, home);
    expect(wallets).toEqual(
      expect.arrayContaining([
        { family: "evm", address: home, linkedAt: null, unlinkedAt: null },
        { family: "solana", address: SOL, linkedAt: Date.parse("2026-09-22T00:00:00Z"), unlinkedAt: null },
        { family: "bitcoin", address: "bc1qxjjcjwmjapj25nupfelq0l94nlftpymfwfac84", linkedAt: Date.parse("2026-09-23T00:00:00Z"), unlinkedAt: null },
        { family: "evm", address: payFrom, linkedAt: Date.parse("2026-09-24T00:00:00Z"), unlinkedAt: Date.parse("2026-09-28T00:00:00Z") },
      ]),
    );
    const spans = wallets.filter((wallet) => wallet.address === payFrom);
    // Paid while it was on the account: still the account's. Before or after: not.
    expect(heldAt(spans, Date.parse("2026-09-25T00:00:00Z"))).toBe(true);
    expect(heldAt(spans, Date.parse("2026-09-23T00:00:00Z"))).toBe(false);
    expect(heldAt(spans, Date.parse("2026-09-29T00:00:00Z"))).toBe(false);
  });

  it("unlinked and linked again: the first span stands, so the evening pass still proves an order from it (m2)", async () => {
    const home = "0xa3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3";
    const relinked = "0xb3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3";
    const user = await account(home);
    await identity(user, `eip155:${home}`, "evm", "siwe", "2026-09-01T00:00:00Z", true);
    await audit(user, "wallet_linked", { family: "evm", wallet: `eip155:${relinked}`, home: false, proof: "siwe" }, "2026-09-05T00:00:00Z");
    await audit(user, "wallet_unlinked", { family: "evm", wallet: `eip155:${relinked}` }, "2026-09-10T00:00:00Z");
    await audit(user, "wallet_linked", { family: "evm", wallet: `eip155:${relinked}`, home: false, proof: "siwe" }, "2026-09-12T00:00:00Z");
    // The relink restarted the row's created_at.
    await identity(user, `eip155:${relinked}`, "evm", "siwe", "2026-09-12T00:00:00Z");
    const spans = (await accountOwnedWallets(user, home)).filter((wallet) => wallet.address === relinked);
    expect(heldAt(spans, Date.parse("2026-09-07T00:00:00Z"))).toBe(true);
    expect(heldAt(spans, Date.parse("2026-09-11T00:00:00Z"))).toBe(false);
    expect(heldAt(spans, Date.parse("2026-09-13T00:00:00Z"))).toBe(true);
  });

  it("after a merge, the absorbed home counts from the start, a siwe-recorded one too, and its other wallets keep their own time (m3)", async () => {
    const survivorHome = "0xc3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3";
    const absorbedHome = "0xd4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4";
    const survivor = await account(survivorHome, "keeper@example.com");
    const absorbed = await account(absorbedHome);
    await identity(survivor, `eip155:${survivorHome}`, "evm", "privy_wallet", "2026-09-01T00:00:00Z", true);
    // The absorbed home was written by recordHomeWallet on a later sign in (proof 'siwe'), long after it first poured.
    await identity(absorbed, `eip155:${absorbedHome}`, "evm", "siwe", "2026-09-25T00:00:00Z", true);
    const absorbedLinked = "0xd5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5";
    await identity(absorbed, `eip155:${absorbedLinked}`, "evm", "siwe", "2026-09-26T00:00:00Z");
    await audit(absorbed, "wallet_linked", { family: "evm", wallet: `eip155:${absorbedLinked}`, home: false, proof: "siwe" }, "2026-09-26T00:00:00Z");
    const result = await mergeAccounts({ survivor, absorbed, reason: "email" });
    expect(result.ok).toBe(true);
    const wallets = await accountOwnedWallets(survivor, survivorHome);
    expect(wallets.filter((wallet) => wallet.address === absorbedHome)).toEqual([
      { family: "evm", address: absorbedHome, linkedAt: null, unlinkedAt: null },
    ]);
    expect(heldAt(wallets.filter((wallet) => wallet.address === absorbedLinked), Date.parse("2026-09-20T00:00:00Z"))).toBe(false);
    expect(heldAt(wallets.filter((wallet) => wallet.address === absorbedLinked), Date.parse("2026-09-27T00:00:00Z"))).toBe(true);
    // The absorbed row no longer names its wallet, as merge_accounts leaves it.
    expect((await q<{ wallet_address: string | null }>(`select wallet_address from users where id = $1`, [absorbed]))[0].wallet_address).toBeNull();
    // So a sell the absorbed home's hub wallet made before the merge is still the survivor's own.
    const intentAt = Date.parse("2026-09-10T00:00:00Z");
    const sell = { ...SPEND, creator: "0x9999999999999999999999999999999999999999", srcChain: 146n, srcAddress: "0x9999999999999999999999999999999999999999", dstChain: 23n, dstAddress: absorbedHome };
    expect(
      judgeOwnership({ direction: "sell", intent: sell, wallets, sourceHub: null, homeHubs: [{ address: sell.creator, linkedAt: null }], intentAt, funding: paidBy(sell.creator), inputIsHubAsset: true }).ok,
    ).toBe(true);
  });

  it("a former home after a home change counts from the start (m3)", async () => {
    const oldHome = "0xe1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1";
    const newHome = "0xe2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2";
    const user = await account(newHome);
    await identity(user, `eip155:${oldHome}`, "evm", "siwe", "2026-09-20T00:00:00Z");
    await identity(user, `eip155:${newHome}`, "evm", "siwe", "2026-09-21T00:00:00Z", true);
    await audit(user, "wallet_linked", { family: "evm", wallet: `eip155:${newHome}`, home: false, proof: "siwe" }, "2026-09-21T00:00:00Z");
    await audit(user, "home_changed", { family: "evm", from: `eip155:${oldHome}`, to: `eip155:${newHome}` }, "2026-09-22T00:00:00Z");
    const wallets = await accountOwnedWallets(user, newHome);
    expect(wallets.find((wallet) => wallet.address === oldHome)).toMatchObject({ linkedAt: null });
    expect(wallets.find((wallet) => wallet.address === newHome)).toMatchObject({ linkedAt: null });
  });
});

describe("a stranger's claim, and the real owner after it", () => {
  it("the evening pass removes a claim not proven the account's, pays and records nothing, and the owner's claim then stands", async () => {
    const strangerId = await account("0xe5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5");
    const ownerHome = "0xf6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6";
    const ownerHub = "0x0707070707070707070707070707070707070707";
    const ownerId = await account(ownerHome);
    await identity(ownerId, `eip155:${ownerHome}`, "evm", "siwe", "2026-09-01T00:00:00Z", true);
    // The Solana fixture's address, linked by the first test's account, is the owner's here.
    await q(`delete from user_identities where value = $1`, [`solana:${SOL}`]);
    await identity(ownerId, `solana:${SOL}`, "solana", "siws", "2026-09-02T00:00:00Z");
    const intentTx = `0x${"5".repeat(64)}`;
    // A claim left from before the proof held for every family.
    await savePourClaim(strangerId, intentTx, "buy", null, "NVDA");

    const intentAt = Date.parse("2026-09-30T00:00:00Z");
    const proven = async (userId: string, usersWallet: string) =>
      judgeOwnership({
        direction: "buy",
        intent: solanaBuy(ownerHub),
        wallets: await accountOwnedWallets(userId, usersWallet),
        sourceHub: SOL_CREATOR,
        homeHubs: userId === ownerId ? [{ address: ownerHub, linkedAt: null }] : [],
        intentAt,
        funding: paidBy(SOL_CREATOR),
        inputIsHubAsset: true,
      });
    const pay = vi.fn(async (claim: { user_id: string; wallet_address?: string | null }) =>
      (await proven(claim.user_id, claim.wallet_address ?? "")).ok ? ("paid" as const) : ("not_owned" as const),
    );

    const first = await settlePourClaims({ verdictOf: async () => "filled", pay });
    expect(first).toMatchObject({ checked: 1, paid: 0, refused: 1 });
    expect(await q(`select 1 from pour_claims where intent_tx = $1`, [intentTx])).toEqual([]);
    expect(await q(`select 1 from orders where intent_tx = $1`, [intentTx])).toEqual([]);
    expect(await q(`select 1 from xp_events where ref = $1`, [intentTx])).toEqual([]);

    // The owner reports it: the claim is theirs now, and it pays.
    await savePourClaim(ownerId, intentTx, "buy", null, "NVDA");
    expect(await q(`select user_id from pour_claims where intent_tx = $1`, [intentTx])).toEqual([{ user_id: ownerId }]);
    const second = await settlePourClaims({ verdictOf: async () => "filled", pay });
    expect(second).toMatchObject({ checked: 1, paid: 1, refused: 0 });
    expect(pay).toHaveBeenLastCalledWith(expect.objectContaining({ user_id: ownerId, wallet_address: ownerHome }));
  });
});

describe("a buy delivered to the account by a payer not proven its", () => {
  it("is marked unproven_source, its order recorded, no XP and no referral pair paid, no hold judged", async () => {
    const inviter = await account("0x1818181818181818181818181818181818181818");
    const owner = (await q<{ id: string }>(`insert into users (wallet_address, referred_by) values ($1, $2) returning id`, [
      "0x1919191919191919191919191919191919191919",
      inviter,
    ]))[0].id;
    const intentTx = `0x${"6".repeat(64)}`;
    await markNoXp(intentTx, "unproven_source");
    // A second mark (the availability one, a replay) never rewrites the reason.
    await markNoXp(intentTx);
    expect(await q(`select reason from no_xp_intents where intent_tx = $1`, [intentTx])).toEqual([{ reason: "unproven_source" }]);
    expect(await isNoXp(intentTx)).toBe(true);
    await q(
      `insert into orders (user_id, intent_tx, direction, listing_symbol, listing_address, quantity, placed_at)
       values ($1, $2, 'buy', 'NVDA', '0xnvda', 0.01, '2026-09-30T10:00:00Z')`,
      [owner, intentTx],
    );
    const outcome = await payRecordedClaim({ user_id: owner, intent_tx: intentTx, direction: "buy", referred_by: inviter, fill_tx: null });
    expect(outcome).toBe("recorded_no_xp");
    expect(await q(`select 1 from xp_events where user_id in ($1, $2)`, [owner, inviter])).toEqual([]);
    expect(await q(`select hold_outcome from orders where intent_tx = $1`, [intentTx])).toEqual([{ hold_outcome: "forfeit" }]);
  });

  it("the reason column refuses anything else", async () => {
    await expect(q(`insert into no_xp_intents (intent_tx, reason) values ('0xbad', 'other')`)).rejects.toThrow();
    await q(`insert into no_xp_intents (intent_tx) values ('0xold')`);
    expect(await q(`select reason from no_xp_intents where intent_tx = '0xold'`)).toEqual([{ reason: "unavailable" }]);
  });
});

describe("a claim whose proof could not be read", () => {
  const intent = { creator: SOL_CREATOR } as unknown as Intent;
  const deps = (verdict: Awaited<ReturnType<ClaimPayDeps["prove"]>>, record = vi.fn(async () => undefined)): ClaimPayDeps => ({
    readIntent: async () => intent,
    prove: async () => verdict,
    record,
  });

  it("stays open for the next night: nothing recorded, marked, deleted or paid", async () => {
    const user = await account("0x2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a");
    const intentTx = `0x${"7".repeat(64)}`;
    await savePourClaim(user, intentTx, "buy", null, "NVDA");
    const record = vi.fn(async () => undefined);
    const pay = (claim: Parameters<typeof payClaim>[0]) => payClaim(claim, deps({ ok: false, why: "reads failed", unknown: true }, record));
    const summary = await settlePourClaims({ verdictOf: async () => "filled", pay });
    expect(summary).toMatchObject({ checked: 1, paid: 0, refused: 0 });
    expect(record).not.toHaveBeenCalled();
    expect(await q(`select settled_at from pour_claims where intent_tx = $1`, [intentTx])).toEqual([{ settled_at: null }]);
    expect(await q(`select 1 from no_xp_intents where intent_tx = $1`, [intentTx])).toEqual([]);
  });

  it("an unproven claim gives way to the owner's proven one, never the other way round", async () => {
    const stranger = await account("0x2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b");
    const owner = await account("0x2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c");
    const intentTx = `0x${"8".repeat(64)}`;
    await savePourClaim(stranger, intentTx, "buy", null, "TSLA", { proven: false });
    await savePourClaim(owner, intentTx, "buy", "0xfill", "NVDA");
    expect(await q(`select user_id, proven, fill_tx, listing_symbol from pour_claims where intent_tx = $1`, [intentTx])).toEqual([
      { user_id: owner, proven: true, fill_tx: "0xfill", listing_symbol: "NVDA" },
    ]);
    // A proven claim is never taken over, by a proven or an unproven report.
    await savePourClaim(stranger, intentTx, "buy", null, "TSLA");
    await savePourClaim(stranger, intentTx, "buy", null, "TSLA", { proven: false });
    expect(await q(`select user_id from pour_claims where intent_tx = $1`, [intentTx])).toEqual([{ user_id: owner }]);
    // The owner's own unproven report of its proven claim keeps it proven.
    await savePourClaim(owner, intentTx, "buy", null, null, { proven: false });
    expect(await q(`select proven from pour_claims where intent_tx = $1`, [intentTx])).toEqual([{ proven: true }]);
  });
});

describe("countsForCampaigns (m6)", () => {
  it("leaves out every no XP intent, whatever its reason, and keeps the rest", async () => {
    const user = await account("0x3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d");
    const insert = (intentTx: string) =>
      q(`insert into orders (user_id, intent_tx, direction, listing_symbol, listing_address) values ($1, $2, 'buy', 'NVDA', '0xnvda')`, [user, intentTx]);
    await insert("0xcount-ok");
    await insert("0xcount-away");
    await insert("0xcount-unproven");
    await markNoXp("0xcount-away");
    await markNoXp("0xcount-unproven", "unproven_source");
    const rows = await q<{ intent_tx: string }>(`select intent_tx from orders o where o.user_id = $1 and ${COUNTS_FOR_CAMPAIGNS("o")} order by intent_tx`, [user]);
    expect(rows).toEqual([{ intent_tx: "0xcount-ok" }]);
    expect(await countsForCampaigns("0xcount-ok")).toBe(true);
    expect(await countsForCampaigns("0xcount-unproven")).toBe(false);
    expect(await countsForCampaigns("0xcount-away")).toBe(false);
  });
});

describe("unproven claims from several accounts (n3)", () => {
  const claimsOn = (intentTx: string) =>
    q<{ user_id: string; proven: boolean; settled_at: string | null; outcome: string | null }>(
      `select user_id, proven, settled_at, outcome from pour_claims where intent_tx = $1 order by user_id`,
      [intentTx],
    );

  it("stand side by side; the evening pass drops the stranger's and settles the owner's, in either order", async () => {
    for (const ownerFirst of [false, true]) {
      const stranger = await account(`0x0${ownerFirst ? 3 : 1}${"ab".repeat(19)}`);
      const owner = await account(`0x0${ownerFirst ? 4 : 2}${"ab".repeat(19)}`);
      const intentTx = `0x${(ownerFirst ? "a" : "b").repeat(64)}`;
      // Both reported while the chain did not answer.
      await savePourClaim(stranger, intentTx, "buy", null, null, { proven: false });
      await savePourClaim(owner, intentTx, "buy", null, null, { proven: false });
      expect((await claimsOn(intentTx)).map((row) => row.user_id).sort()).toEqual([owner, stranger].sort());
      // Make the loop meet them in the order under test.
      await q(`update pour_claims set created_at = $3 where intent_tx = $1 and user_id = $2`, [intentTx, ownerFirst ? owner : stranger, "2026-09-01T00:00:00Z"]);
      const pay = vi.fn(async (claim: { user_id: string }) => (claim.user_id === owner ? ("paid" as const) : ("not_owned" as const)));
      await settlePourClaims({ verdictOf: async (tx) => (tx === intentTx ? "filled" : "unknown"), pay, limit: 50 });
      const rows = await claimsOn(intentTx);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ user_id: owner, outcome: "paid" });
      expect(rows[0].settled_at).not.toBeNull();
    }
  });

  it("a proven claim makes the unproven ones give way, and none comes back after it", async () => {
    const stranger = await account("0x13ababababababababababababababababababab");
    const owner = await account("0x14ababababababababababababababababababab");
    const intentTx = `0x${"c".repeat(64)}`;
    await savePourClaim(stranger, intentTx, "buy", null, null, { proven: false });
    await savePourClaim(owner, intentTx, "buy", null, "NVDA");
    expect((await claimsOn(intentTx)).map((row) => row.user_id)).toEqual([owner]);
    await savePourClaim(stranger, intentTx, "buy", null, null, { proven: false });
    await savePourClaim(stranger, intentTx, "buy", null, null);
    expect((await claimsOn(intentTx)).map((row) => row.user_id)).toEqual([owner]);
  });

  it("the pour route's own close drops the other accounts' open claims", async () => {
    const stranger = await account("0x15ababababababababababababababababababab");
    const owner = await account("0x16ababababababababababababababababababab");
    const intentTx = `0x${"d".repeat(64)}`;
    await savePourClaim(stranger, intentTx, "buy", null, null, { proven: false });
    await savePourClaim(owner, intentTx, "buy", null, null, { proven: false });
    const { closePourClaim } = await import("./pour-claims");
    await closePourClaim(intentTx, new Date(), "paid", owner);
    const rows = await claimsOn(intentTx);
    expect(rows).toEqual([expect.objectContaining({ user_id: owner, outcome: "paid" })]);
  });

  it("two accounts that both claimed one intent can still be merged", async () => {
    const survivor = await account("0x4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e", "merge-keeper@example.com");
    const absorbed = await account("0x4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f");
    const intentTx = `0x${"e".repeat(64)}`;
    await savePourClaim(survivor, intentTx, "buy", null, null, { proven: false });
    await savePourClaim(absorbed, intentTx, "buy", null, null, { proven: false });
    expect((await mergeAccounts({ survivor, absorbed, reason: "email" })).ok).toBe(true);
    expect((await claimsOn(intentTx)).map((row) => row.user_id)).toEqual([survivor]);
  });
});
