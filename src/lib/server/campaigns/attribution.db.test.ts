import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setSqlClient, type SqlClient } from "../db";
import { makeTestDb } from "../pglite-test-db";
import { awardXp, bindReferral, ensureReferralCode, getOrCreateUser, type UserRow } from "../accounts";
import { attributeSignup, campaignLanding, claimById } from "./store";

/**
 * Campaign attribution against the real schema: a claim only for a new
 * account whose first sync carries the exact code of a live signup
 * campaign, opened inside its dates, once per account. A personal invite
 * never makes a claim, with or without a campaign live; a wrong, inactive,
 * ended or retired code makes none and falls back to nothing; an account
 * that already existed makes none; and the invite binding itself is left
 * as it was.
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

async function campaign(
  code: string,
  { active = true, startsInDays = -1, endsInDays = 30, kind = "signup" }: { active?: boolean; startsInDays?: number; endsInDays?: number; kind?: string } = {},
): Promise<string> {
  const rows = (await sql.query(
    `insert into campaigns (code, title, kind, starts_at, ends_at, active)
     values ($1, $1, $5, now() + make_interval(days => $2), now() + make_interval(days => $3), $4) returning id`,
    [code, startsInDays, endsInDays, active, kind],
  )) as { id: string }[];
  return rows[0].id;
}

/** A new account invited by `inviter` with a personal invite, bound as the first sync binds it. */
async function invitedBy(inviter: UserRow): Promise<UserRow> {
  const withCode = await ensureReferralCode(inviter);
  const friend = await account();
  expect(await bindReferral(friend.id, withCode.referral_code!)).toBe(inviter.id);
  return { ...friend, referred_by: inviter.id };
}

const claimsOf = async (userId: string) => (await sql.query(`select id from campaign_claims where user_id = $1`, [userId])) as unknown[];

const pause = async () => sql.query(`update campaigns set active = false`);

describe("signup attribution", () => {
  it("makes one claim for a new account that arrived with a live campaign's code, naming no inviter", async () => {
    await pause();
    const id = await campaign("attr-live");
    const signup = await account();
    const claimId = await attributeSignup(signup.id, "attr-live");
    const claim = (await claimById(claimId!))!;
    expect(claim).toMatchObject({ campaign_id: id, user_id: signup.id, inviter_id: null, state: "attributed" });
    expect(await attributeSignup(signup.id, "attr-live")).toBeNull();
  });

  it("takes the code as the pocket carries it, in any case", async () => {
    await pause();
    const id = await campaign("attr-case");
    const claimId = await attributeSignup((await account()).id, " Attr-Case ");
    expect((await claimById(claimId!))!.campaign_id).toBe(id);
  });

  it("makes nothing for a personal invite, with or without a campaign live", async () => {
    await pause();
    const friend = await invitedBy(await account());
    expect(await attributeSignup(friend.id, undefined)).toBeNull();
    await campaign("attr-personal");
    const another = await invitedBy(await account());
    expect(await attributeSignup(another.id, undefined)).toBeNull();
    expect(await attributeSignup(another.id, null)).toBeNull();
    expect(await claimsOf(another.id)).toHaveLength(0);
  });

  it("makes nothing for a wrong code, and never falls back to another live campaign", async () => {
    await pause();
    await campaign("attr-real");
    const signup = await account();
    expect(await attributeSignup(signup.id, "attr-nope")).toBeNull();
    expect(await attributeSignup(signup.id, "x")).toBeNull();
    expect(await claimsOf(signup.id)).toHaveLength(0);
  });

  it("makes nothing while the campaign is inactive, ended or not begun, and nothing for a retired buy or invite campaign", async () => {
    await pause();
    await campaign("attr-inactive", { active: false });
    await campaign("attr-ended", { startsInDays: -10, endsInDays: -1 });
    await campaign("attr-later", { startsInDays: 1, endsInDays: 10 });
    await campaign("attr-buy", { kind: "buy" });
    await campaign("attr-invite", { kind: "invite" });
    const signup = await account();
    for (const code of ["attr-inactive", "attr-ended", "attr-later", "attr-buy", "attr-invite"]) {
      expect(await attributeSignup(signup.id, code), code).toBeNull();
    }
    expect(await claimsOf(signup.id)).toHaveLength(0);
  });

  it("makes nothing for an account opened before the campaign started, or older than 72 hours", async () => {
    await pause();
    await campaign("attr-dates", { startsInDays: -1 });
    const early = await account();
    await sql.query(`update users set created_at = now() - interval '2 days' where id = $1`, [early.id]);
    expect(await attributeSignup(early.id, "attr-dates")).toBeNull();
    await campaign("attr-old", { startsInDays: -10 });
    const old = await account();
    await sql.query(`update users set created_at = now() - interval '4 days' where id = $1`, [old.id]);
    expect(await attributeSignup(old.id, "attr-old")).toBeNull();
  });

  it("makes nothing for an account that already had its first sync: visiting the link later is not new", async () => {
    await pause();
    await campaign("attr-synced");
    const existing = await account();
    await awardXp(existing.id, "account_created", null);
    expect(await attributeSignup(existing.id, "attr-synced")).toBeNull();
  });

  it("makes nothing for an account merged into another", async () => {
    await pause();
    await campaign("attr-merged");
    const signup = await account();
    const survivor = await account();
    await sql.query(`update users set retired_into = $2 where id = $1`, [signup.id, survivor.id]);
    expect(await attributeSignup(signup.id, "attr-merged")).toBeNull();
  });

  it("counts a personally invited account only through the campaign link, and leaves the invite binding as it was", async () => {
    await pause();
    await campaign("attr-friends");
    const inviter = await account();
    const friend = await invitedBy(inviter);
    const claimId = await attributeSignup(friend.id, "attr-friends");
    expect((await claimById(claimId!))!).toMatchObject({ user_id: friend.id, inviter_id: null });
    const rows = (await sql.query(`select referred_by from users where id = $1`, [friend.id])) as { referred_by: string }[];
    expect(rows[0].referred_by).toBe(inviter.id);
    expect(await claimsOf(inviter.id)).toHaveLength(0);
  });

  it("the landing shows only a live signup campaign's promise, and says plainly why there is none", async () => {
    await pause();
    await campaign("land-signup");
    await campaign("land-buy", { kind: "buy" });
    await campaign("land-invite", { kind: "invite" });
    await campaign("land-draft", { active: false });
    const paused = await campaign("land-paused", { active: false });
    await sql.query(`update campaigns set activated_at = now() - interval '1 day' where id = $1`, [paused]);
    await campaign("land-over", { startsInDays: -10, endsInDays: -1 });
    await campaign("land-soon", { startsInDays: 2, endsInDays: 10 });
    const live = await campaignLanding("Land-Signup");
    expect(live).toMatchObject({ state: "live", code: "land-signup", amountUsd: 5, stayDays: 7 });
    expect(await campaignLanding("land-buy")).toEqual({ state: "ended" });
    expect(await campaignLanding("land-invite")).toEqual({ state: "ended" });
    expect(await campaignLanding("land-draft")).toEqual({ state: "unknown" });
    expect(await campaignLanding("land-paused")).toEqual({ state: "paused" });
    expect(await campaignLanding("land-over")).toEqual({ state: "ended" });
    expect(await campaignLanding("land-soon")).toEqual({ state: "unknown" });
    expect(await campaignLanding("no-such-code")).toEqual({ state: "unknown" });
    // Every place taken: the link stops promising.
    const full = await campaign("land-full");
    await sql.query(`update campaigns set max_claims = 1 where id = $1`, [full]);
    expect(await campaignLanding("land-full")).toMatchObject({ state: "live" });
    await sql.query(`insert into campaign_claims (campaign_id, user_id, state) values ($1, $2, 'holding')`, [full, (await account()).id]);
    expect(await campaignLanding("land-full")).toEqual({ state: "full" });
    expect(await campaignLanding("nope!")).toEqual({ state: "unknown" });
  });
});

describe("the migration of an invite campaign", () => {
  it("turns an invite campaign that never made a claim into a switched off signup one, and leaves one that did retired", async () => {
    const fresh = await campaign("mig-fresh", { kind: "invite", active: true });
    const used = await campaign("mig-used", { kind: "invite", active: false });
    await sql.query(`insert into campaign_claims (campaign_id, user_id, state) values ($1, $2, 'expired')`, [used, (await account()).id]);
    // The statement exactly as db:push runs it, from db/schema.sql.
    const schema = readFileSync(join(process.cwd(), "db/schema.sql"), "utf8");
    const statement = schema.split(/;\s*\n/).find((text) => text.includes("update campaigns c set kind = 'signup'"));
    expect(statement).toBeTruthy();
    await sql.query(statement!);
    const kinds = (await sql.query(`select id, kind, active from campaigns where id = any($1::uuid[])`, [[fresh, used]])) as { id: string; kind: string; active: boolean }[];
    expect(Object.fromEntries(kinds.map((row) => [row.id, row.kind]))).toEqual({ [fresh]: "signup", [used]: "invite" });
    // Switched off: it goes live under the new rules only through the activation gates again.
    expect(kinds.find((row) => row.id === fresh)!.active).toBe(false);
  });
});
