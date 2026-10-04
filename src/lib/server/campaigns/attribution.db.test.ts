import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setSqlClient, type SqlClient } from "../db";
import { makeTestDb } from "../pglite-test-db";
import { bindReferral, ensureReferralCode, getOrCreateUser, type UserRow } from "../accounts";
import { attributeInvite, campaignForLanding, claimById } from "./store";

/**
 * Invite claim attribution against the real schema: only an account that
 * carries someone's invite, young, opened inside a live invite campaign's
 * dates, once per account; the pocketed campaign code chooses between
 * live campaigns; a retired buy campaign never attributes; and the invite
 * binding itself is left as it was.
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
  { active = true, startsInDays = -1, endsInDays = 30, kind = "invite" }: { active?: boolean; startsInDays?: number; endsInDays?: number; kind?: string } = {},
): Promise<string> {
  const rows = (await sql.query(
    `insert into campaigns (code, title, kind, starts_at, ends_at, active)
     values ($1, $1, $5, now() + make_interval(days => $2), now() + make_interval(days => $3), $4) returning id`,
    [code, startsInDays, endsInDays, active, kind],
  )) as { id: string }[];
  return rows[0].id;
}

/** A new account invited by `inviter`, the invite bound as the first sync binds it. */
async function invitedBy(inviter: UserRow): Promise<UserRow> {
  const withCode = await ensureReferralCode(inviter);
  const friend = await account();
  expect(await bindReferral(friend.id, withCode.referral_code!)).toBe(inviter.id);
  return { ...friend, referred_by: inviter.id };
}

const pause = async () => sql.query(`update campaigns set active = false`);

describe("invite attribution", () => {
  it("makes one claim for an invited new account, naming its inviter, inside a live invite campaign", async () => {
    await pause();
    const id = await campaign("attr-live");
    const inviter = await account();
    const friend = await invitedBy(inviter);
    const claimId = await attributeInvite(friend.id);
    const claim = (await claimById(claimId!))!;
    expect(claim).toMatchObject({ campaign_id: id, user_id: friend.id, inviter_id: inviter.id, state: "attributed" });
    expect(await attributeInvite(friend.id)).toBeNull();
  });

  it("makes nothing for an account nobody invited", async () => {
    await pause();
    await campaign("attr-uninvited");
    expect(await attributeInvite((await account()).id, "attr-uninvited")).toBeNull();
  });

  it("makes nothing while the campaign is inactive, and nothing for a retired buy campaign", async () => {
    await pause();
    await campaign("attr-inactive", { active: false });
    await campaign("attr-buy", { kind: "buy" });
    const friend = await invitedBy(await account());
    expect(await attributeInvite(friend.id, "attr-buy")).toBeNull();
  });

  it("makes nothing for an account opened before the campaign started, or older than 72 hours", async () => {
    await pause();
    await campaign("attr-dates", { startsInDays: -1 });
    const early = await invitedBy(await account());
    await sql.query(`update users set created_at = now() - interval '2 days' where id = $1`, [early.id]);
    expect(await attributeInvite(early.id)).toBeNull();
    await pause();
    await campaign("attr-old", { startsInDays: -10 });
    const old = await invitedBy(await account());
    await sql.query(`update users set created_at = now() - interval '4 days' where id = $1`, [old.id]);
    expect(await attributeInvite(old.id)).toBeNull();
  });

  it("makes nothing for an account merged into another", async () => {
    await pause();
    await campaign("attr-merged");
    const friend = await invitedBy(await account());
    const survivor = await account();
    await sql.query(`update users set retired_into = $2 where id = $1`, [friend.id, survivor.id]);
    expect(await attributeInvite(friend.id)).toBeNull();
  });

  it("lets the pocketed code choose between live campaigns, else takes the one that started first", async () => {
    await pause();
    const first = await campaign("attr-first", { startsInDays: -2 });
    const second = await campaign("attr-second", { startsInDays: -1 });
    const a = await invitedBy(await account());
    expect((await claimById((await attributeInvite(a.id, "attr-second"))!))!.campaign_id).toBe(second);
    const b = await invitedBy(await account());
    expect((await claimById((await attributeInvite(b.id))!))!.campaign_id).toBe(first);
  });

  it("leaves the invite binding and the friendship as they were", async () => {
    await pause();
    await campaign("attr-friends");
    const inviter = await account();
    const friend = await invitedBy(inviter);
    await attributeInvite(friend.id);
    const rows = (await sql.query(`select referred_by from users where id = $1`, [friend.id])) as { referred_by: string }[];
    expect(rows[0].referred_by).toBe(inviter.id);
  });

  it("the landing shows only a live invite campaign's promise", async () => {
    await pause();
    await campaign("land-invite");
    await campaign("land-buy", { kind: "buy" });
    expect(await campaignForLanding("Land-Invite")).toMatchObject({ code: "land-invite", amountUsd: 5, stayDays: 7, perInviter: 3 });
    expect(await campaignForLanding("land-buy")).toBeNull();
    expect(await campaignForLanding("nope!")).toBeNull();
  });
});
