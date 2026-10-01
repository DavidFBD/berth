import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setSqlClient, type SqlClient } from "../db";
import { makeTestDb } from "../pglite-test-db";
import { getOrCreateUser } from "../accounts";
import { markNoXp } from "../no-xp";
import { CASH_LISTING } from "@/lib/listings";
import { claimById } from "./store";
import { campaignProgress, ownBuy, runCampaignStep } from "./eligibility";
import { advance, arrival, buy, campaign, DAY, DEPS, hex, hubOf, next, state, verifier } from "./test-kit";

/**
 * Every eligibility rule against the real schema (PGlite): the verified
 * email, a new customer, the first qualifying buy (a market buy of a stock
 * or fund, at least the minimum, not cash, not a no XP buy, after the claim
 * and inside the dates, delivered to and paid from the person's own
 * wallets), the slot reserved atomically under the budget and max_claims
 * (two racing for the last slot, a waiting line), one per person across
 * merged accounts, one per wallet, the hold window, the deadline.
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

const later = (days: number) => new Date(Date.now() + days * DAY);

describe("the verified email", () => {
  it("keeps an account without one attributed, and moves one with it to buying", async () => {
    await campaign("email-rule");
    const without = await arrival("email-rule", { email: false });
    await buy(without.user);
    expect(await advance(without.claimId)).toBe("attributed");
    const withEmail = await arrival("email-rule");
    expect(await advance(withEmail.claimId)).toBe("buying");
  });
});

describe("the first qualifying buy", () => {
  it("is a filled market buy of a stock or fund worth at least the minimum", async () => {
    await campaign("buy-rule");
    const { user, claimId } = await arrival("buy-rule");
    await buy(user, { usd: 9.99 });
    expect(await advance(claimId)).toBe("buying");
    await buy(user, { usd: 50, listing: CASH_LISTING.address });
    expect(await advance(claimId)).toBe("buying");
    await buy(user, { usd: null });
    expect(await advance(claimId)).toBe("buying");
    await buy(user, { usd: 40, direction: "sell" });
    expect(await advance(claimId)).toBe("buying");
    await buy(user, { usd: 40, orderType: "limit" });
    expect(await advance(claimId)).toBe("buying");
    const noXp = await buy(user, { usd: 40 });
    await markNoXp(noXp.intentTx);
    expect(await advance(claimId)).toBe("buying");
    const real = await buy(user, { usd: 10 });
    expect(await advance(claimId)).toBe("holding");
    const claim = (await claimById(claimId))!;
    expect(claim.intent_tx).toBe(real.intentTx);
    expect(claim.buy_usd).toBe(10);
    expect(claim.eligible_at!.getTime() - claim.holding_since!.getTime()).toBe(7 * DAY);
  });

  it("must be delivered to the person's own hub wallet, and paid from their own EVM wallet", async () => {
    await campaign("own-buy");
    const { user, claimId } = await arrival("own-buy");
    await buy(user, { payer: "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV", deliveredTo: hubOf(hex(0xdead01)) });
    expect(await advance(claimId)).toBe("buying");
    await buy(user, { payer: hex(0xdead02) });
    expect(await advance(claimId)).toBe("buying");
    await buy(user, { payer: "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV" });
    expect(await advance(claimId)).toBe("holding");
  });

  it("counts a linked wallet only while it was linked", () => {
    const wallet = { address: hex(0xaa), since: Date.parse("2026-10-06T00:00:00Z"), until: null, hub: hubOf(hex(0xaa)) };
    const order = { deliveredTo: hubOf(hex(0xaa)), payer: hex(0xaa), effectiveAt: new Date("2026-10-05T00:00:00Z") };
    expect(ownBuy(order, [wallet])).toBe(false);
    const after = { ...order, effectiveAt: new Date("2026-10-07T00:00:00Z") };
    expect(ownBuy(after, [wallet])).toBe(true);
    expect(ownBuy(after, [{ ...wallet, until: Date.parse("2026-10-06T12:00:00Z") }])).toBe(false);
  });

  it("waits while the campaign is paused, and carries on once it is active again", async () => {
    const id = await campaign("paused-one");
    const { user, claimId } = await arrival("paused-one");
    await sql.query(`update campaigns set active = false where id = $1`, [id]);
    await buy(user);
    expect(await advance(claimId)).toBe("inactive");
    expect((await state(claimId)).state).toBe("buying");
    await sql.query(`update campaigns set active = true where id = $1`, [id]);
    expect(await advance(claimId)).toBe("holding");
  });

  it("expires after the deadline (the end plus the hold's days) without one", async () => {
    const id = await campaign("ends-soon");
    const { claimId } = await arrival("ends-soon");
    await sql.query(`update campaigns set ends_at = now() - interval '1 minute' where id = $1`, [id]);
    expect(await advance(claimId)).toBe("buying");
    expect(await advance(claimId, later(8))).toBe("expired");
    expect(await state(claimId)).toEqual({ state: "expired", reason: "ended" });
  });
});

describe("a new customer", () => {
  it("refuses a person whose account has an order from before the claim", async () => {
    await campaign("old-order");
    const { user, claimId } = await arrival("old-order");
    await buy(user, { filledAt: new Date(Date.now() - DAY) });
    await buy(user);
    expect(await advance(claimId)).toBe("existing_customer");
    expect(await state(claimId)).toEqual({ state: "rejected", reason: "existing_customer" });
  });
});

describe("the budget and max_claims", () => {
  it("gives the last slot to one of two claims racing for it, and the other waits", async () => {
    await campaign("last-slot", { maxClaims: 1 });
    const a = await arrival("last-slot");
    const b = await arrival("last-slot");
    await buy(a.user);
    await buy(b.user);
    const outcomes = await Promise.all([advance(a.claimId), advance(b.claimId)]);
    expect([...outcomes].sort()).toEqual(["holding", "waitlisted"]);
    const states = [await state(a.claimId), await state(b.claimId)].map((s) => s.state).sort();
    expect(states).toEqual(["buying", "holding"]);
  });

  it("counts dollars against the budget, reserved and paid alike", async () => {
    await campaign("ten-dollars", { budget: 10, amount: 5 });
    const claims = [await arrival("ten-dollars"), await arrival("ten-dollars"), await arrival("ten-dollars")];
    for (const claim of claims) await buy(claim.user);
    expect(await advance(claims[0].claimId)).toBe("holding");
    await sql.query(`update campaign_claims set state = 'paid', paid_at = now() where id = $1`, [claims[0].claimId]);
    expect(await advance(claims[1].claimId)).toBe("holding");
    expect(await advance(claims[2].claimId)).toBe("waitlisted");
  });

  it("gives a freed slot to the claim that waited longest, and expires the rest as full only after the deadline", async () => {
    const id = await campaign("freed-slot", { maxClaims: 1 });
    const a = await arrival("freed-slot");
    const b = await arrival("freed-slot");
    const c = await arrival("freed-slot");
    for (const claim of [a, b, c]) await buy(claim.user);
    expect(await advance(a.claimId)).toBe("holding");
    expect(await advance(b.claimId)).toBe("waitlisted");
    expect(await advance(c.claimId, later(0.01))).toBe("waitlisted");
    await sql.query(`update campaign_claims set state = 'rejected', reject_reason = 'abuse' where id = $1`, [a.claimId]);
    expect(await advance(c.claimId, later(0.02))).toBe("waitlisted");
    expect(await advance(b.claimId, later(0.02))).toBe("holding");
    await sql.query(`update campaigns set ends_at = now() + interval '5 seconds' where id = $1`, [id]);
    expect(await advance(c.claimId, later(1))).toBe("waitlisted");
    expect(await advance(c.claimId, later(9))).toBe("expired");
    expect(await state(c.claimId)).toEqual({ state: "expired", reason: "full" });
  });
});

describe("one per person, one per wallet", () => {
  it("counts accounts merged into one as one person", async () => {
    await campaign("merged-pair");
    const a = await arrival("merged-pair");
    const b = await arrival("merged-pair");
    await buy(a.user);
    expect(await advance(a.claimId)).toBe("holding");
    await buy(b.user, { deliveredTo: hubOf(a.home), payer: a.home });
    await sql.query(`update orders set user_id = $1 where user_id = $2`, [a.user.id, b.user.id]);
    await sql.query(`update users set retired_into = $1, privy_did = 'merged:' || privy_did, wallet_address = null where id = $2`, [
      a.user.id,
      b.user.id,
    ]);
    expect(await advance(b.claimId)).toBe("one_per_person");
    expect(await state(b.claimId)).toEqual({ state: "rejected", reason: "one_per_person" });
    expect((await campaignProgress(a.user.id, new Date(), DEPS))?.state).toBe("holding");
  });

  it("refuses a person whose linked wallet, even one since unlinked, stood on another claim", async () => {
    await campaign("linked-wallet");
    const a = await arrival("linked-wallet");
    const b = await arrival("linked-wallet");
    await buy(a.user);
    expect(await advance(a.claimId)).toBe("holding");
    await sql.query(
      `insert into user_identities (user_id, kind, value, family, proof, unlinked_at)
       values ($1, 'wallet', $2, 'solana', 'siws', now() - interval '30 days')`,
      [b.user.id, "solana:7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV"],
    );
    await sql.query(
      `insert into campaign_claim_wallets (campaign_id, wallet, claim_id)
       select campaign_id, '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV', id from campaign_claims where id = $1`,
      [a.claimId],
    );
    await buy(b.user);
    expect(await advance(b.claimId)).toBe("wallet_used");
  });
});

describe("the hold window", () => {
  async function holding(code: string) {
    await campaign(code);
    const arrived = await arrival(code);
    await buy(arrived.user);
    expect(await advance(arrived.claimId)).toBe("holding");
    return arrived;
  }

  it("judges nothing before the hold days are over", async () => {
    const { claimId } = await holding("not-due");
    const check = verifier(() => "held");
    await runCampaignStep({ verifyHold: check, deps: DEPS });
    expect((await state(claimId)).state).toBe("holding");
    expect(check.asked).toHaveLength(0);
  });

  it("qualifies a buy kept the whole hold, rejects one sold on the way, and reads the window to its end", async () => {
    const kept = await holding("kept-it");
    const sold = await holding("sold-it");
    const soldWallet = hubOf(sold.home);
    const check = verifier((query) => (query.holder === soldWallet ? "not_held" : "held"));
    const summary = await runCampaignStep({ now: later(8), verifyHold: check, deps: DEPS });
    expect(await state(kept.claimId)).toEqual({ state: "qualified", reason: null });
    expect(await state(sold.claimId)).toEqual({ state: "rejected", reason: "not_held" });
    expect(summary.qualified).toBeGreaterThanOrEqual(1);
    expect(summary.notHeld).toBeGreaterThanOrEqual(1);
    const asked = check.asked.find((query) => query.holder === hubOf(kept.home))!;
    expect(asked.quantity).toBe("0.05");
    expect(asked.until.getTime()).toBe((await claimById(kept.claimId))!.eligible_at!.getTime());
    const evidence = (await claimById(kept.claimId))!.hold_evidence as Record<string, unknown>;
    expect(evidence).toMatchObject({ needed: "0.05", lowestRaw: "50000000000000000", outflows: 0 });
  });

  it("retries a window it could not read, never judging on doubt", async () => {
    const { claimId } = await holding("unread");
    await runCampaignStep({ now: later(8), verifyHold: verifier(() => "unknown"), deps: DEPS });
    const claim = (await claimById(claimId))!;
    expect(claim.state).toBe("holding");
    expect(claim.hold_attempted_at).not.toBeNull();
  });

  it("flags a window unread for three days and lets its slot go after seven", async () => {
    const { claimId } = await holding("long-unread");
    const unread = verifier(() => "unknown");
    await runCampaignStep({ now: later(8), verifyHold: unread, deps: DEPS });
    expect((await claimById(claimId))!.hold_unreadable_since).not.toBeNull();
    await runCampaignStep({ now: later(12), verifyHold: unread, deps: DEPS });
    expect((await state(claimId)).state).toBe("holding");
    await runCampaignStep({ now: later(15.5), verifyHold: unread, deps: DEPS });
    expect(await state(claimId)).toEqual({ state: "rejected", reason: "hold_unreadable" });
  });

  it("clears the unread mark once the window reads", async () => {
    const { claimId } = await holding("read-again");
    await runCampaignStep({ now: later(8), verifyHold: verifier(() => "unknown"), deps: DEPS });
    await runCampaignStep({ now: later(9), verifyHold: verifier(() => "held"), deps: DEPS });
    expect((await claimById(claimId))!).toMatchObject({ state: "qualified", hold_unreadable_since: null });
  });

  it("never qualifies a buy marked no XP after its slot was reserved", async () => {
    const { claimId } = await holding("late-mark");
    await markNoXp((await claimById(claimId))!.intent_tx!);
    await runCampaignStep({ now: later(8), verifyHold: verifier(() => "held"), deps: DEPS });
    expect(await state(claimId)).toEqual({ state: "rejected", reason: "not_held" });
  });

  it("closes a claim whose order is gone instead of retrying it forever", async () => {
    const { claimId } = await holding("gone-order");
    await sql.query(`delete from orders where id = (select order_id from campaign_claims where id = $1)`, [claimId]);
    await runCampaignStep({ now: later(8), verifyHold: verifier(() => "held"), deps: DEPS });
    expect(await state(claimId)).toEqual({ state: "rejected", reason: "order_missing" });
  });

  it("judges first, so a pile of open claims cannot starve the held ones", async () => {
    const { claimId } = await holding("judged-first");
    for (let i = 0; i < 3; i += 1) await arrival("judged-first");
    let ticks = 0;
    const summary = await runCampaignStep({
      now: later(8),
      verifyHold: verifier(() => "held"),
      deps: DEPS,
      deadline: 1,
      clock: () => (ticks++ === 0 ? 0 : 2),
    });
    expect((await state(claimId)).state).toBe("qualified");
    expect(summary.advanced).toBe(0);
  });
});

describe("the person's progress", () => {
  it("answers nothing for an account that came through no campaign", async () => {
    const user = (await getOrCreateUser({ did: `did:privy:none-${next()}`, wallet: null }))!.user;
    expect(await campaignProgress(user.id)).toBeNull();
  });

  it("advances on read and says the dates while holding", async () => {
    await campaign("on-read");
    const { user } = await arrival("on-read");
    expect(await campaignProgress(user.id, new Date(), DEPS)).toMatchObject({ state: "buying", amountUsd: 5, minBuyUsd: 10, holdDays: 7 });
    await buy(user);
    const progress = await campaignProgress(user.id, new Date(Date.now() + 2_000), DEPS);
    expect(progress?.state).toBe("holding");
    expect(new Date(progress!.eligibleAt!).getTime() - new Date(progress!.holdingSince!).getTime()).toBe(7 * DAY);
  });

  it("says nothing for an expiry with no buy, and nothing while the campaign is paused", async () => {
    const id = await campaign("quiet-close");
    const { user, claimId } = await arrival("quiet-close");
    await sql.query(`update campaigns set active = false where id = $1`, [id]);
    expect(await campaignProgress(user.id, new Date(), DEPS)).toBeNull();
    await sql.query(`update campaign_claims set state = 'expired', expire_reason = 'ended', expired_at = now() where id = $1`, [claimId]);
    expect(await campaignProgress(user.id, new Date(), DEPS)).toBeNull();
  });

  it("shows a closed line for fourteen days, then nothing", async () => {
    await campaign("closed-line");
    const { user, claimId } = await arrival("closed-line");
    await sql.query(`update campaign_claims set state = 'rejected', reject_reason = 'not_held', rejected_at = now() where id = $1`, [claimId]);
    expect((await campaignProgress(user.id, new Date(), DEPS))?.state).toBe("rejected");
    expect(await campaignProgress(user.id, later(15), DEPS)).toBeNull();
  });
});
