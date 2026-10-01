import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setSqlClient, type SqlClient } from "../db";
import { makeTestDb } from "../pglite-test-db";
import { awardXp, bindReferral, ensureReferralCode, getOrCreateUser, type UserRow } from "../accounts";
import { attributeCampaign, campaignForLanding } from "./store";

/**
 * Campaign attribution against the real schema: only a new account, on its
 * first sync, only through an active campaign inside its dates, once per
 * account; and an invite code arriving with it still binds as before.
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

let seq = 0;
async function account(): Promise<UserRow> {
  seq += 1;
  const result = await getOrCreateUser({ did: `did:privy:camp-${seq}`, wallet: null });
  return result!.user;
}

async function campaign(code: string, { active = true, startsInDays = -1, endsInDays = 30 } = {}): Promise<string> {
  const rows = (await sql.query(
    `insert into campaigns (code, title, starts_at, ends_at, active)
     values ($1, $1, now() + make_interval(days => $2), now() + make_interval(days => $3), $4) returning id`,
    [code, startsInDays, endsInDays, active],
  )) as { id: string }[];
  return rows[0].id;
}

describe("attribution", () => {
  it("attributes a new account through an active campaign, once", async () => {
    const id = await campaign("launch-one");
    const user = await account();
    const claim = await attributeCampaign(user.id, "Launch-One ");
    expect(claim).toBeTruthy();
    const rows = (await sql.query(`select campaign_id, state from campaign_claims where user_id = $1`, [user.id])) as {
      campaign_id: string;
      state: string;
    }[];
    expect(rows).toEqual([{ campaign_id: id, state: "attributed" }]);
    expect(await attributeCampaign(user.id, "launch-one")).toBeNull();
  });

  it("is created inactive by default and an inactive campaign attributes nobody", async () => {
    const rows = (await sql.query(
      `insert into campaigns (code, title, starts_at, ends_at) values ('quiet-one', 'q', now() - interval '1 day', now() + interval '1 day') returning active, amount_usd::float8 as a, budget_usd::float8 as b, max_claims, min_buy_usd::float8 as m, hold_days`,
    )) as Record<string, unknown>[];
    expect(rows[0]).toEqual({ active: false, a: 5, b: 100, max_claims: 20, m: 10, hold_days: 7 });
    const user = await account();
    expect(await attributeCampaign(user.id, "quiet-one")).toBeNull();
    expect(await campaignForLanding("quiet-one")).toBeNull();
  });

  it("attributes nobody before the start or after the end", async () => {
    await campaign("not-yet", { startsInDays: 2, endsInDays: 10 });
    await campaign("all-over", { startsInDays: -10, endsInDays: -1 });
    const user = await account();
    expect(await attributeCampaign(user.id, "not-yet")).toBeNull();
    expect(await attributeCampaign(user.id, "all-over")).toBeNull();
    expect(await campaignForLanding("all-over")).toBeNull();
  });

  it("never attributes an account that already synced", async () => {
    await campaign("old-hand");
    const user = await account();
    await awardXp(user.id, "account_created", null);
    expect(await attributeCampaign(user.id, "old-hand")).toBeNull();
  });

  it("never attributes an account older than 72 hours", async () => {
    await campaign("too-old");
    const user = await account();
    await sql.query(`update users set created_at = now() - interval '4 days' where id = $1`, [user.id]);
    expect(await attributeCampaign(user.id, "too-old")).toBeNull();
  });

  it("refuses codes that are not codes, and unknown codes", async () => {
    const user = await account();
    expect(await attributeCampaign(user.id, "../etc")).toBeNull();
    expect(await attributeCampaign(user.id, "no-such-campaign")).toBeNull();
    expect(await attributeCampaign(user.id, 42)).toBeNull();
  });

  it("holds one claim per account, whichever campaign comes second", async () => {
    await campaign("first-come");
    await campaign("second-come");
    const user = await account();
    expect(await attributeCampaign(user.id, "first-come")).toBeTruthy();
    expect(await attributeCampaign(user.id, "second-come")).toBeNull();
  });

  it("leaves the invite code's binding as it was", async () => {
    await campaign("with-friend");
    const referrer = await ensureReferralCode(await account());
    const user = await account();
    expect(await attributeCampaign(user.id, "with-friend")).toBeTruthy();
    expect(await bindReferral(user.id, referrer.referral_code!)).toBe(referrer.id);
  });

  it("the landing shows an active campaign's promise", async () => {
    await campaign("show-me");
    expect(await campaignForLanding("show-me")).toEqual({ code: "show-me", amountUsd: 5, minBuyUsd: 10, holdDays: 7 });
  });
});
