import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setSqlClient, type SqlClient } from "../db";
import { makeTestDb } from "../pglite-test-db";
import { claimById } from "./store";
import { activeFrom, campaignProgress, inviteStillEligible, runCampaignStep, sameHands, stillActive } from "./eligibility";
import { advance, campaign, DAY, heldWallet, invited, person, qualifiedClaim, seen, state, username } from "./test-kit";

/**
 * Every invite campaign rule against the real schema (PGlite): set up
 * (email, username, wallet), the farming guards (self invite by wallet,
 * email or merge; an account that was on Berth before; staff marked;
 * an email already on another account), one payout per real person by
 * wallet and email, the per inviter cap, the budget and places with a
 * waiting line, the deadline, the stay judged from signed in visits, the
 * retired buy campaigns, and the inviter's progress. No rule reads an
 * order: nobody buys anything in these tests.
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
  it("keeps a friend attributed until the email, the username and the wallet are all there, then reserves a place", async () => {
    await campaign("setup-rule", { stayDays: 14 });
    const inviter = await person();
    const { user, claimId } = await invited(inviter, { email: false });
    expect(await advance(claimId)).toBe("attributed");
    await username(user);
    expect(await advance(claimId)).toBe("attributed");
    await sql.query(`update users set email = 'setup-friend@example.com' where id = $1`, [user.id]);
    const now = later(0.001);
    expect(await advance(claimId, now)).toBe("holding");
    const claim = (await claimById(claimId))!;
    expect(claim.onboarded_at!.toISOString()).toBe(now.toISOString());
    expect(claim.eligible_at!.getTime()).toBe(now.getTime() + 14 * DAY);
    expect(claim.inviter_id).toBe(inviter.id);
  });

  it("needs a wallet: an account with no home address stays attributed", async () => {
    await campaign("wallet-rule");
    const inviter = await person();
    const { user, claimId } = await invited(inviter);
    await username(user);
    await sql.query(`update users set wallet_address = null, privy_did = coalesce(privy_did, 'did:privy:nowallet') where id = $1`, [user.id]);
    expect(await advance(claimId)).toBe("attributed");
  });

  it("never asks for a buy: a friend with no order at all reaches qualified", async () => {
    await campaign("no-buy");
    const { claimId, friend } = await qualifiedClaim("no-buy");
    const orders = (await sql.query(`select count(*)::int as n from orders where user_id = $1`, [friend.id])) as { n: number }[];
    expect(orders[0].n).toBe(0);
    expect((await state(claimId)).state).toBe("qualified");
  });
});

describe("the self invite guard", () => {
  it("is pure: one person, a shared wallet or a shared folded email", () => {
    const a = { accounts: ["a"], wallets: ["0x1"], emails: ["a@x.com"] };
    expect(sameHands(a, { accounts: ["a"], wallets: [], emails: [] })).toBe(true);
    expect(sameHands(a, { accounts: ["b"], wallets: ["0x1"], emails: [] })).toBe(true);
    expect(sameHands(a, { accounts: ["b"], wallets: [], emails: ["a@x.com"] })).toBe(true);
    expect(sameHands(a, { accounts: ["b"], wallets: ["0x2"], emails: ["b@x.com"] })).toBe(false);
  });

  it("rejects a friend who once held the inviter's wallet", async () => {
    await campaign("self-wallet");
    const inviter = await person();
    const { user, claimId } = await invited(inviter);
    await heldWallet(user, inviter.home);
    await username(user);
    expect(await advance(claimId)).toBe("self_invite");
    expect(await state(claimId)).toEqual({ state: "rejected", reason: "self_invite" });
  });

  it("rejects a friend whose email is an alias of the inviter's", async () => {
    await campaign("self-email");
    const inviter = await person({ email: "jane.doe@gmail.com" });
    const { user, claimId } = await invited(inviter, { email: "janedoe+berth@gmail.com" });
    await username(user);
    expect(await advance(claimId)).toBe("self_invite");
  });

  it("rejects a friend merged into the inviter's own account", async () => {
    await campaign("self-merge");
    const inviter = await person();
    const { user, claimId } = await invited(inviter);
    // Merged into an account of the inviter's, made before: the friend is the inviter.
    await sql.query(`update users set retired_into = $2 where id = $1`, [user.id, inviter.id]);
    expect(await advance(claimId)).toBe("self_invite");
  });
});

describe("new accounts only", () => {
  it("rejects a friend merged into an account that was on Berth before", async () => {
    await campaign("merged-old");
    const inviter = await person();
    const old = await person();
    await sql.query(`update users set created_at = now() - interval '30 days' where id = $1`, [old.id]);
    const { user, claimId } = await invited(inviter);
    await sql.query(`update users set retired_into = $2 where id = $1`, [user.id, old.id]);
    expect(await advance(claimId)).toBe("existing_customer");
  });

  it("rejects a friend whose email is already on another account", async () => {
    await campaign("email-elsewhere");
    await person({ email: "second.life@example.com" });
    const inviter = await person();
    const { user, claimId } = await invited(inviter, { email: "second.life+new@example.com" });
    await username(user);
    expect(await advance(claimId)).toBe("email_used");
  });
});

describe("staff marked not eligible", () => {
  it("rejects a claim whose inviter, or friend, staff marked", async () => {
    await campaign("staff-mark");
    const inviter = await person();
    const { user, claimId } = await invited(inviter);
    await username(user);
    await sql.query(`update users set campaign_ineligible_at = now() where id = $1`, [inviter.id]);
    expect(await advance(claimId)).toBe("staff_ineligible");
    const other = await person();
    const second = await invited(other);
    await username(second.user);
    await sql.query(`update users set campaign_ineligible_at = now() where id = $1`, [second.user.id]);
    expect(await advance(second.claimId)).toBe("staff_ineligible");
  });
});

describe("one payout per real person", () => {
  it("refuses a second claim standing on a wallet that already counted, whoever invited it", async () => {
    await campaign("one-wallet");
    const first = await invited(await person());
    await username(first.user);
    expect(await advance(first.claimId)).toBe("holding");
    const second = await invited(await person());
    await username(second.user);
    await heldWallet(second.user, first.user.home);
    expect(await advance(second.claimId)).toBe("wallet_used");
    expect(await state(second.claimId)).toEqual({ state: "rejected", reason: "wallet_used" });
  });

  it("counts across campaigns: the marks are global", async () => {
    await campaign("marks-a");
    const first = await invited(await person(), { code: "marks-a" });
    await username(first.user);
    expect(await advance(first.claimId)).toBe("holding");
    const second = await invited(await person(), { code: "marks-b-none" });
    await username(second.user);
    await heldWallet(second.user, first.user.home);
    expect(await advance(second.claimId)).toBe("wallet_used");
  });

  it("is asked again at approval: a wallet linked after the place was taken refuses it", async () => {
    await campaign("late-link");
    const a = await qualifiedClaim("late-link");
    const b = await invited(await person(), { code: "late-link" });
    await username(b.user);
    expect(await advance(b.claimId)).toBe("holding");
    await heldWallet(b.user, a.friend.home);
    expect(await inviteStillEligible((await claimById(b.claimId))!)).toBe("wallet_used");
    // The first to stand on the wallet keeps it.
    expect(await inviteStillEligible((await claimById(a.claimId))!)).toBeNull();
  });
});

describe("the per inviter cap", () => {
  it("pays one inviter for at most max_per_inviter friends in a campaign", async () => {
    await campaign("cap", { perInviter: 2 });
    const inviter = await person();
    const outcomes: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const friend = await invited(inviter, { code: "cap" });
      await username(friend.user);
      outcomes.push(String(await advance(friend.claimId)));
    }
    expect(outcomes).toEqual(["holding", "holding", "inviter_cap"]);
  });

  it("counts the inviter after a merge: two accounts of one inviter share one cap", async () => {
    await campaign("cap-merge", { perInviter: 1 });
    const inviter = await person();
    const alt = await person();
    const one = await invited(inviter, { code: "cap-merge" });
    await username(one.user);
    expect(await advance(one.claimId)).toBe("holding");
    const two = await invited(alt, { code: "cap-merge" });
    await username(two.user);
    await sql.query(`update users set retired_into = $2 where id = $1`, [alt.id, inviter.id]);
    expect(await advance(two.claimId)).toBe("inviter_cap");
  });
});

describe("the budget and the places", () => {
  it("lets a claim that found every place taken wait, gives it the place that frees, and expires it as full after the deadline", async () => {
    const id = await campaign("places", { maxClaims: 1, endsInDays: 2, stayDays: 7 });
    const a = await invited(await person(), { code: "places" });
    const b = await invited(await person(), { code: "places" });
    await username(a.user);
    await username(b.user);
    expect(await advance(a.claimId)).toBe("holding");
    expect(await advance(b.claimId)).toBe("waitlisted");
    await sql.query(`update campaign_claims set state = 'rejected', reject_reason = 'abuse' where id = $1`, [a.claimId]);
    expect(await advance(b.claimId)).toBe("holding");
    const c = await invited(await person(), { code: "places" });
    await username(c.user);
    expect(await advance(c.claimId)).toBe("waitlisted");
    expect(await advance(c.claimId, later(10))).toBe("expired");
    expect(await state(c.claimId)).toEqual({ state: "expired", reason: "full" });
    expect(id).toBeTruthy();
  });

  it("counts dollars against the budget", async () => {
    await campaign("dollars", { amount: 5, budget: 5, maxClaims: 10 });
    const a = await invited(await person(), { code: "dollars" });
    const b = await invited(await person(), { code: "dollars" });
    await username(a.user);
    await username(b.user);
    expect(await advance(a.claimId)).toBe("holding");
    expect(await advance(b.claimId)).toBe("waitlisted");
  });

  it("reserves nobody while paused, and expires an open claim as ended after the deadline", async () => {
    const id = await campaign("paused", { endsInDays: 1, stayDays: 7 });
    const a = await invited(await person(), { code: "paused" });
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

  it("judges nothing before the stay is over, then qualifies a friend who came back and rejects one who did not", async () => {
    await campaign("stay", { stayDays: 14 });
    const back = await invited(await person(), { code: "stay" });
    const gone = await invited(await person(), { code: "stay" });
    for (const friend of [back, gone]) {
      await username(friend.user);
      expect(await advance(friend.claimId)).toBe("holding");
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

  it("counts a visit on any account merged into the friend", async () => {
    await campaign("stay-merged", { stayDays: 7 });
    const friend = await invited(await person(), { code: "stay-merged" });
    await username(friend.user);
    expect(await advance(friend.claimId)).toBe("holding");
    const eligible = (await claimById(friend.claimId))!.eligible_at!;
    const absorbed = await person();
    await sql.query(`update users set retired_into = $2, last_seen_at = $3 where id = $1`, [absorbed.id, friend.user.id, new Date(eligible.getTime() - DAY).toISOString()]);
    await runCampaignStep({ now: new Date(eligible.getTime() + 60_000) });
    expect((await state(friend.claimId)).state).toBe("qualified");
  });
});

describe("the retired buy campaigns", () => {
  it("attribute nobody, and an open claim of one expires on the next run", async () => {
    const id = await campaign("old-buy", { kind: "buy" });
    const inviter = await person();
    const friend = await invited(inviter, { code: "old-buy", expectClaim: false });
    // Whatever the pocketed code, a buy campaign is never chosen.
    const claims = (await sql.query(`select campaign_id from campaign_claims where user_id = $1`, [friend.user.id])) as { campaign_id: string }[];
    expect(claims.every((row) => row.campaign_id !== id)).toBe(true);
    const legacy = await person();
    const rows = (await sql.query(`insert into campaign_claims (campaign_id, user_id, state) values ($1, $2, 'buying') returning id`, [id, legacy.id])) as { id: string }[];
    expect(await advance(rows[0].id)).toBe("expired");
  });
});

describe("the inviter's progress", () => {
  it("says the rules while a campaign is live, then each friend's step, and nothing to the invited friend about a buy", async () => {
    await campaign("progress", { stayDays: 14, amount: 5, perInviter: 3 });
    const inviter = await person();
    const before = await campaignProgress(inviter.id);
    expect(before).toMatchObject({ open: true, invited: 0, staying: 0 });
    const friend = await invited(inviter, { code: "progress" });
    expect(await campaignProgress(inviter.id)).toMatchObject({ invited: 1 });
    await username(friend.user);
    // Read advances it: the friend is set up now.
    const staying = await campaignProgress(inviter.id);
    expect(staying).toMatchObject({ invited: 0, staying: 1 });
    expect(staying!.nextEligibleAt).toBe((await claimById(friend.claimId))!.eligible_at!.toISOString());
    expect(Object.keys(staying!).some((key) => /buy|hold/i.test(key))).toBe(false);
  });

  it("answers nothing when no campaign is live and nobody this person invited holds a claim", async () => {
    await sql.query(`update campaigns set active = false`);
    const nobody = await person();
    expect(await campaignProgress(nobody.id)).toBeNull();
  });
});
