import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setSqlClient, type SqlClient } from "../db";
import { makeTestDb } from "../pglite-test-db";
import { claimById } from "./store";
import { activeFrom, campaignProgress, campaignSetUp, onboarded, runCampaignStep, sameHands, stillActive, stillEligible } from "./eligibility";
import { advance, campaign, DAY, heldWallet, joined, person, qualifiedClaim, seen, state, username } from "./test-kit";

/**
 * Every signup campaign rule against the real schema (PGlite): set up
 * (email, username, wallet), the farming guards (an account that was on
 * Berth before; staff marked; an email already on another account), one
 * payout per real person by wallet and email, the budget and places with a
 * waiting line, the deadline, the stay judged from signed in visits, the
 * retired buy and invite campaigns, and the account's own progress. No
 * rule reads an order: nobody buys anything in these tests.
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

describe("set up", () => {
  it("keeps a new account attributed until the email, the username and the wallet are all there, then reserves a place", async () => {
    await campaign("setup-rule", { stayDays: 14 });
    const { user, claimId } = await joined({ email: false });
    expect(await advance(claimId)).toBe("attributed");
    await username(user);
    expect(await advance(claimId)).toBe("attributed");
    await sql.query(`update users set email = 'setup-friend@example.com' where id = $1`, [user.id]);
    const now = later(0.001);
    expect(await advance(claimId, now)).toBe("holding");
    const claim = (await claimById(claimId))!;
    expect(claim.onboarded_at!.toISOString()).toBe(now.toISOString());
    expect(claim.eligible_at!.getTime()).toBe(now.getTime() + 14 * DAY);
    expect(claim.inviter_id).toBeNull();
  });

  it("needs a wallet: an account with no home address stays attributed", async () => {
    await campaign("wallet-rule");
    const { user, claimId } = await joined();
    await username(user);
    await sql.query(`update users set wallet_address = null, privy_did = coalesce(privy_did, 'did:privy:nowallet') where id = $1`, [user.id]);
    expect(await advance(claimId)).toBe("attributed");
  });

  it("needs an EVM home wallet, to be paid on Base: a Solana home stays attributed", async () => {
    await campaign("evm-rule");
    const { user, claimId } = await joined();
    await username(user);
    await sql.query(`update users set wallet_address = '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV' where id = $1`, [user.id]);
    expect(await advance(claimId)).toBe("attributed");
    // Invite XP's own set up rule is unchanged: any wallet counts there.
    expect(await onboarded(user.id)).toBe(true);
    expect(await campaignSetUp(user.id)).toBe(false);
    await sql.query(`update users set wallet_address = $2 where id = $1`, [user.id, user.home]);
    expect(await advance(claimId)).toBe("holding");
  });

  it("never asks for a buy: an account with no order at all reaches qualified", async () => {
    await campaign("no-buy");
    const { claimId, user } = await qualifiedClaim("no-buy");
    const orders = (await sql.query(`select count(*)::int as n from orders where user_id = $1`, [user.id])) as { n: number }[];
    expect(orders[0].n).toBe(0);
    expect((await state(claimId)).state).toBe("qualified");
  });
});

describe("sameHands, kept for invite XP", () => {
  it("is pure: one person, a shared wallet or a shared folded email", () => {
    const a = { accounts: ["a"], wallets: ["0x1"], emails: ["a@x.com"] };
    expect(sameHands(a, { accounts: ["a"], wallets: [], emails: [] })).toBe(true);
    expect(sameHands(a, { accounts: ["b"], wallets: ["0x1"], emails: [] })).toBe(true);
    expect(sameHands(a, { accounts: ["b"], wallets: [], emails: ["a@x.com"] })).toBe(true);
    expect(sameHands(a, { accounts: ["b"], wallets: ["0x2"], emails: ["b@x.com"] })).toBe(false);
  });
});

describe("new accounts only", () => {
  it("rejects an account merged into one that was on Berth before", async () => {
    await campaign("merged-old");
    const old = await person();
    await sql.query(`update users set created_at = now() - interval '30 days' where id = $1`, [old.id]);
    const { user, claimId } = await joined();
    await sql.query(`update users set retired_into = $2 where id = $1`, [user.id, old.id]);
    expect(await advance(claimId)).toBe("existing_customer");
  });

  it("rejects an account whose email is already on another account", async () => {
    await campaign("email-elsewhere");
    await person({ email: "second.life@example.com" });
    const { user, claimId } = await joined({ email: "second.life+new@example.com" });
    await username(user);
    expect(await advance(claimId)).toBe("email_used");
  });
});

describe("staff marked not eligible", () => {
  it("rejects a claim whose account staff marked", async () => {
    await campaign("staff-mark");
    const second = await joined();
    await username(second.user);
    await sql.query(`update users set campaign_ineligible_at = now() where id = $1`, [second.user.id]);
    expect(await advance(second.claimId)).toBe("staff_ineligible");
  });
});

describe("one payout per real person", () => {
  it("refuses a second claim standing on a wallet that already counted", async () => {
    await campaign("one-wallet");
    const first = await joined();
    await username(first.user);
    expect(await advance(first.claimId)).toBe("holding");
    const second = await joined();
    await username(second.user);
    await heldWallet(second.user, first.user.home);
    expect(await advance(second.claimId)).toBe("wallet_used");
    expect(await state(second.claimId)).toEqual({ state: "rejected", reason: "wallet_used" });
  });

  it("counts across campaigns: the marks are global", async () => {
    await campaign("marks-a");
    const first = await joined({ code: "marks-a" });
    await username(first.user);
    expect(await advance(first.claimId)).toBe("holding");
    await campaign("marks-b");
    const second = await joined({ code: "marks-b" });
    await username(second.user);
    await heldWallet(second.user, first.user.home);
    expect(await advance(second.claimId)).toBe("wallet_used");
  });

  it("is asked again at approval: a wallet linked after the place was taken refuses it", async () => {
    await campaign("late-link");
    const a = await qualifiedClaim("late-link");
    const b = await joined({ code: "late-link" });
    await username(b.user);
    expect(await advance(b.claimId)).toBe("holding");
    await heldWallet(b.user, a.user.home);
    expect(await stillEligible((await claimById(b.claimId))!)).toBe("wallet_used");
    // The first to stand on the wallet keeps it.
    expect(await stillEligible((await claimById(a.claimId))!)).toBeNull();
  });
});

describe("no per inviter cap", () => {
  it("lets every new account of a campaign take a place, up to the places, whoever shared the link", async () => {
    await campaign("no-cap", { maxClaims: 5 });
    const outcomes: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const signup = await joined({ code: "no-cap" });
      await username(signup.user);
      outcomes.push(String(await advance(signup.claimId)));
    }
    expect(outcomes).toEqual(["holding", "holding", "holding", "holding"]);
  });
});

describe("the budget and the places", () => {
  it("lets a claim that found every place taken wait, gives it the place that frees, and expires it as full after the deadline", async () => {
    const id = await campaign("places", { maxClaims: 1, endsInDays: 2, stayDays: 7 });
    const a = await joined({ code: "places" });
    const b = await joined({ code: "places" });
    await username(a.user);
    await username(b.user);
    expect(await advance(a.claimId)).toBe("holding");
    expect(await advance(b.claimId)).toBe("waitlisted");
    await sql.query(`update campaign_claims set state = 'rejected', reject_reason = 'abuse' where id = $1`, [a.claimId]);
    expect(await advance(b.claimId)).toBe("holding");
    const c = await joined({ code: "places" });
    await username(c.user);
    expect(await advance(c.claimId)).toBe("waitlisted");
    expect(await advance(c.claimId, later(10))).toBe("expired");
    expect(await state(c.claimId)).toEqual({ state: "expired", reason: "full" });
    expect(id).toBeTruthy();
  });

  it("counts dollars against the budget", async () => {
    await campaign("dollars", { amount: 5, budget: 5, maxClaims: 10 });
    const a = await joined({ code: "dollars" });
    const b = await joined({ code: "dollars" });
    await username(a.user);
    await username(b.user);
    expect(await advance(a.claimId)).toBe("holding");
    expect(await advance(b.claimId)).toBe("waitlisted");
  });

  it("reserves nobody while paused, and expires an open claim as ended after the deadline", async () => {
    const id = await campaign("paused", { endsInDays: 1, stayDays: 7 });
    const a = await joined({ code: "paused" });
    await username(a.user);
    await sql.query(`update campaigns set active = false where id = $1`, [id]);
    expect(await advance(a.claimId)).toBe("inactive");
    expect(await advance(a.claimId, later(9))).toBe("expired");
    expect(await state(a.claimId)).toEqual({ state: "expired", reason: "ended" });
  });
});

describe("still using Berth", () => {
  it("is pure: a visit in the last week of the stay, on a later day than the set up", () => {
    const onboarded = new Date("2026-10-01T10:00:00Z");
    const claim = { onboarded_at: onboarded, eligible_at: new Date(onboarded.getTime() + 14 * DAY) };
    expect(activeFrom(claim).toISOString()).toBe(new Date(onboarded.getTime() + 7 * DAY).toISOString());
    expect(stillActive(claim, new Date(onboarded.getTime() + 8 * DAY))).toBe(true);
    expect(stillActive(claim, new Date(onboarded.getTime() + 6 * DAY))).toBe(false);
    expect(stillActive(claim, null)).toBe(false);
    const short = { onboarded_at: onboarded, eligible_at: new Date(onboarded.getTime() + 7 * DAY) };
    expect(activeFrom(short).getTime()).toBe(onboarded.getTime() + DAY);
    expect(stillActive(short, new Date(onboarded.getTime() + 3_600_000))).toBe(false);
  });

  it("judges nothing before the stay is over, then qualifies an account that came back and rejects one that did not", async () => {
    await campaign("stay", { stayDays: 14 });
    const back = await joined({ code: "stay" });
    const gone = await joined({ code: "stay" });
    for (const signup of [back, gone]) {
      await username(signup.user);
      expect(await advance(signup.claimId)).toBe("holding");
    }
    const eligible = (await claimById(back.claimId))!.eligible_at!;
    await seen(back.user, new Date(eligible.getTime() - 2 * DAY));
    await seen(gone.user, new Date(eligible.getTime() - 10 * DAY));
    await runCampaignStep({ now: new Date(eligible.getTime() - DAY) });
    expect((await state(back.claimId)).state).toBe("holding");
    const summary = await runCampaignStep({ now: new Date(eligible.getTime() + 3_600_000) });
    expect(summary.qualified).toBeGreaterThanOrEqual(1);
    expect(summary.notActive).toBeGreaterThanOrEqual(1);
    expect(await state(back.claimId)).toEqual({ state: "qualified", reason: null });
    expect(await state(gone.claimId)).toEqual({ state: "rejected", reason: "not_active" });
    expect((await claimById(back.claimId))!.hold_evidence).toMatchObject({ lastSeenAt: expect.any(String) });
  });

  it("counts a visit on any account merged into the one paid", async () => {
    await campaign("stay-merged", { stayDays: 7 });
    const signup = await joined({ code: "stay-merged" });
    await username(signup.user);
    expect(await advance(signup.claimId)).toBe("holding");
    const eligible = (await claimById(signup.claimId))!.eligible_at!;
    const absorbed = await person();
    await sql.query(`update users set retired_into = $2, last_seen_at = $3 where id = $1`, [absorbed.id, signup.user.id, new Date(eligible.getTime() - DAY).toISOString()]);
    await runCampaignStep({ now: new Date(eligible.getTime() + 60_000) });
    expect((await state(signup.claimId)).state).toBe("qualified");
  });
});

describe("the retired buy and invite campaigns", () => {
  it("attribute nobody, and an open claim of one expires on the next run", async () => {
    for (const kind of ["buy", "invite"] as const) {
      const id = await campaign(`old-${kind}`, { kind });
      const signup = await joined({ code: `old-${kind}`, expectClaim: false });
      expect(signup.claimId).toBe("");
      const legacy = await person();
      const rows = (await sql.query(`insert into campaign_claims (campaign_id, user_id, state) values ($1, $2, 'attributed') returning id`, [id, legacy.id])) as { id: string }[];
      expect(await advance(rows[0].id)).toBe("expired");
    }
  });
});

describe("the account's own progress", () => {
  it("walks setting up, staying, qualified and paid for the account that arrived, and nothing about a buy", async () => {
    await campaign("progress", { stayDays: 14, amount: 5 });
    const signup = await joined({ code: "progress" });
    expect(await campaignProgress(signup.user.id)).toMatchObject({ status: "setting_up", amountUsd: 5, stayDays: 14, eligibleAt: null });
    await username(signup.user);
    // Read advances it: the account is set up now.
    const staying = await campaignProgress(signup.user.id);
    expect(staying).toMatchObject({ status: "staying" });
    expect(staying!.eligibleAt).toBe((await claimById(signup.claimId))!.eligible_at!.toISOString());
    expect(Object.keys(staying!).some((key) => /buy|hold|invit/i.test(key))).toBe(false);
    await sql.query(`update campaign_claims set state = 'approved' where id = $1`, [signup.claimId]);
    expect(await campaignProgress(signup.user.id)).toMatchObject({ status: "qualified" });
    await sql.query(`update campaign_claims set state = 'paid', paid_at = now() where id = $1`, [signup.claimId]);
    expect(await campaignProgress(signup.user.id)).toMatchObject({ status: "paid" });
    await sql.query(`update campaign_claims set state = 'rejected', reject_reason = 'abuse' where id = $1`, [signup.claimId]);
    expect(await campaignProgress(signup.user.id)).toBeNull();
  });

  it("says waiting to an account set up while every place is taken, or while the campaign is paused", async () => {
    const id = await campaign("progress-full", { maxClaims: 1 });
    const first = await joined({ code: "progress-full" });
    await username(first.user);
    expect(await advance(first.claimId)).toBe("holding");
    const second = await joined({ code: "progress-full" });
    expect(await campaignProgress(second.user.id)).toMatchObject({ status: "setting_up", deadline: null });
    await username(second.user);
    const waiting = await campaignProgress(second.user.id);
    expect(waiting).toMatchObject({ status: "waiting" });
    const row = (await sql.query(`select ends_at, hold_days from campaigns where id = $1`, [id])) as { ends_at: Date; hold_days: number }[];
    expect(waiting!.deadline).toBe(new Date(new Date(row[0].ends_at).getTime() + row[0].hold_days * DAY).toISOString());
    const paused = await campaign("progress-paused", { active: true });
    const third = await joined({ code: "progress-paused" });
    await sql.query(`update campaigns set active = false where id = $1`, [paused]);
    expect(await campaignProgress(third.user.id)).toMatchObject({ status: "setting_up" });
    await username(third.user);
    expect(await campaignProgress(third.user.id)).toMatchObject({ status: "waiting" });
  });

  it("answers nothing to anyone else: an account with no claim, or one whose invitee arrived through the link", async () => {
    await campaign("progress-other");
    const inviter = await person();
    const signup = await joined({ code: "progress-other" });
    await sql.query(`update users set referred_by = $2 where id = $1`, [signup.user.id, inviter.id]);
    expect(await campaignProgress(inviter.id)).toBeNull();
    expect(await campaignProgress((await person()).id)).toBeNull();
  });
});
