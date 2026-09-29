import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setSqlClient, type SqlClient } from "./db";
import { makeTestDb } from "./pglite-test-db";
import { awardXp, bindReferral, claimReferral, ensureReferralCode, getOrCreateUser, referralPanel, type UserRow } from "./accounts";
import { setBlock } from "./social/blocks";
import { FRIENDS_MAX } from "./social/friends";
import { setHandle } from "./social/handles";
import { backfillReferralFriends } from "./social/referral-backfill";

/**
 * Referrals against the real schema (PGlite): the code binds on an
 * account's first sync whichever request created its row, only once and
 * only for a new account, and a bind makes the pair friends unless a block
 * or a full list stands in the way. The backfill follows the same rule.
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
async function account({ email = false }: { email?: boolean } = {}): Promise<UserRow> {
  seq += 1;
  const result = await getOrCreateUser({ did: `did:privy:ref-${seq}`, wallet: null });
  if (email) await sql.query(`update users set email = $2 where id = $1`, [result!.user.id, `r${seq}@example.com`]);
  return { ...result!.user, email: email ? `r${seq}@example.com` : null };
}

async function walletAccount(): Promise<UserRow> {
  seq += 1;
  const wallet = `0x${seq.toString(16).padStart(40, "0")}`;
  // The wallet-only path: a rewards route other than the profile sync may
  // be the one that creates the row.
  const result = await getOrCreateUser({ did: null, wallet });
  expect(result!.created).toBe(true);
  return result!.user;
}

async function friends(a: string, b: string): Promise<boolean> {
  const rows = (await sql.query(`select 1 from friends where a_id = least($1::uuid, $2::uuid) and b_id = greatest($1::uuid, $2::uuid)`, [a, b])) as unknown[];
  return rows.length > 0;
}

async function audits(actor: string): Promise<{ action: string; meta: Record<string, string> }[]> {
  return (await sql.query(`select action, meta from social_audit where actor_id = $1 and action = 'friend_referral'`, [actor])) as {
    action: string;
    meta: Record<string, string>;
  }[];
}

describe("the code binds on the first sync", () => {
  it("binds for a wallet account another request created, and makes the two friends", async () => {
    const referrer = await ensureReferralCode(await account());
    const friend = await walletAccount();
    // The profile sync arrives second: created is false for it now.
    const again = await getOrCreateUser({ did: null, wallet: friend.wallet_address });
    expect(again!.created).toBe(false);
    expect(await bindReferral(friend.id, referrer.referral_code!)).toBe(referrer.id);
    expect(await friends(friend.id, referrer.id)).toBe(true);
    expect(await audits(friend.id)).toEqual([{ action: "friend_referral", meta: { via: "invite" } }]);
  });

  it("binds exactly once", async () => {
    const referrer = await ensureReferralCode(await account());
    const other = await ensureReferralCode(await account());
    const friend = await account();
    expect(await bindReferral(friend.id, referrer.referral_code!)).toBe(referrer.id);
    expect(await bindReferral(friend.id, referrer.referral_code!)).toBeNull();
    expect(await bindReferral(friend.id, other.referral_code!)).toBeNull();
    expect(await friends(friend.id, other.id)).toBe(false);
    expect(await audits(friend.id)).toHaveLength(1);
  });

  it("refuses an account that has synced before (its welcome is paid)", async () => {
    const referrer = await ensureReferralCode(await account());
    const old = await account();
    await awardXp(old.id, "account_created", null);
    expect(await bindReferral(old.id, referrer.referral_code!)).toBeNull();
    expect(await friends(old.id, referrer.id)).toBe(false);
  });

  it("refuses self-referral, a poured account, and one past the window", async () => {
    const self = await ensureReferralCode(await account());
    expect(await bindReferral(self.id, self.referral_code!)).toBeNull();

    const referrer = await ensureReferralCode(await account());
    const poured = await account();
    await awardXp(poured.id, "pour_in", `0x${"7".repeat(64)}`);
    expect(await bindReferral(poured.id, referrer.referral_code!)).toBeNull();

    const late = await account();
    await sql.query(`update users set created_at = now() - interval '73 hours' where id = $1`, [late.id]);
    expect(await bindReferral(late.id, referrer.referral_code!)).toBeNull();
  });
});

describe("a referral makes friends", () => {
  it("by hand-typed code too, and settles a live request between them", async () => {
    const referrer = await ensureReferralCode(await account());
    const friend = await account();
    await sql.query(`insert into friend_requests (from_id, to_id, via, status) values ($1, $2, 'handle', 'pending')`, [friend.id, referrer.id]);
    expect(await claimReferral(friend.id, referrer.referral_code!)).toBe(referrer.id);
    expect(await friends(friend.id, referrer.id)).toBe(true);
    const requests = (await sql.query(`select status from friend_requests where from_id = $1`, [friend.id])) as { status: string }[];
    expect(requests).toEqual([{ status: "accepted" }]);
    expect(await audits(friend.id)).toEqual([{ action: "friend_referral", meta: { via: "code" } }]);
  });

  it("not across a block either way; the referral still stands", async () => {
    const referrer = await ensureReferralCode(await account({ email: true }));
    const friend = await account({ email: true });
    const name = `blocked_${seq}`;
    expect((await setHandle(friend, name)).ok).toBe(true);
    await setBlock(referrer, name, true);
    expect(await bindReferral(friend.id, referrer.referral_code!)).toBe(referrer.id);
    expect(await friends(friend.id, referrer.id)).toBe(false);
    expect(await audits(friend.id)).toEqual([]);
  });

  it("not when the referrer once declined a request from this account; the referral still binds", async () => {
    const referrer = await ensureReferralCode(await account());
    const friend = await account();
    await sql.query(
      `insert into friend_requests (from_id, to_id, via, status, responded_at) values ($1, $2, 'handle', 'declined', now())`,
      [friend.id, referrer.id],
    );
    expect(await bindReferral(friend.id, referrer.referral_code!)).toBe(referrer.id);
    expect(await friends(friend.id, referrer.id)).toBe(false);
    expect(await audits(friend.id)).toEqual([]);

    // Cancelled after the decline: still a no.
    const referrer2 = await ensureReferralCode(await account());
    const friend2 = await account();
    await sql.query(
      `insert into friend_requests (from_id, to_id, via, status, responded_at) values ($1, $2, 'handle', 'withdrawn', now())`,
      [friend2.id, referrer2.id],
    );
    expect(await claimReferral(friend2.id, referrer2.referral_code!)).toBe(referrer2.id);
    expect(await friends(friend2.id, referrer2.id)).toBe(false);
  });

  it("not when either list is full, silently", async () => {
    const referrer = await ensureReferralCode(await account());
    for (let i = 0; i < FRIENDS_MAX; i++) {
      const pal = await account();
      await sql.query(`insert into friends (a_id, b_id) values (least($1::uuid, $2::uuid), greatest($1::uuid, $2::uuid))`, [referrer.id, pal.id]);
    }
    const friend = await account();
    expect(await bindReferral(friend.id, referrer.referral_code!)).toBe(referrer.id);
    expect(await friends(friend.id, referrer.id)).toBe(false);
  });

  it("shows in the referred side's panel, with the referrer's name", async () => {
    const referrer = await ensureReferralCode(await account({ email: true }));
    const name = `harbour_${seq}`;
    expect((await setHandle(referrer, name)).ok).toBe(true);
    const friend = await account();
    const referrerId = await bindReferral(friend.id, referrer.referral_code!);
    const panel = await referralPanel({ ...friend, referred_by: referrerId });
    expect(panel.invitedBy).toMatchObject({ friends: true, name });
  });
});

describe("the backfill", () => {
  it("befriends old pairs by the same rule, and a second run makes none", async () => {
    const referrer = await ensureReferralCode(await account());
    const oldFriend = await account();
    // Bound before 2026-09-29: referred_by written, no friendship.
    await sql.query(`update users set referred_by = $2 where id = $1`, [oldFriend.id, referrer.id]);
    const dry = await backfillReferralFriends({ write: false });
    expect(dry.toMake).toBeGreaterThanOrEqual(1);
    expect(dry.made).toBe(0);
    expect(await friends(oldFriend.id, referrer.id)).toBe(false);

    const wrote = await backfillReferralFriends({ write: true });
    expect(wrote.made).toBe(dry.toMake);
    expect(await friends(oldFriend.id, referrer.id)).toBe(true);
    expect(await audits(oldFriend.id)).toEqual([{ action: "friend_referral", meta: { via: "backfill" } }]);

    const again = await backfillReferralFriends({ write: false });
    expect(again.toMake).toBe(0);
    expect(again.alreadyFriends).toBe(wrote.alreadyFriends + wrote.made);
  });
});
