import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setSqlClient, type SqlClient } from "./db";
import { makeTestDb } from "./pglite-test-db";
import {
  awardXp,
  bindReferral,
  claimReferral,
  ensureReferralCode,
  flushUnannounced,
  getOrCreateUser,
  recordReferralClick,
  referralPanel,
  xpHistory,
  type UserRow,
} from "./accounts";
import { XP_ACTIONS } from "@/lib/xp";

/**
 * The till against a real Postgres (PGlite) with the real schema — these
 * are the guards the unit tests could never reach: the award CTE's
 * idempotency, the partial unique indexes, the claim window's interval
 * arithmetic, the never-steal-an-address rule.
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
async function freshUser(): Promise<UserRow> {
  seq += 1;
  const result = await getOrCreateUser({
    did: `did:privy:test-${seq}`,
    wallet: null,
  });
  return result!.user;
}

const HASH = (n: number) => `0x${String(n).padStart(64, "0")}`;

describe("getOrCreateUser", () => {
  it("creates on first sight, finds on the second", async () => {
    const first = await getOrCreateUser({ did: "did:privy:alpha", wallet: null });
    const second = await getOrCreateUser({ did: "did:privy:alpha", wallet: null });
    expect(first!.created).toBe(true);
    expect(second!.created).toBe(false);
    expect(second!.user.id).toBe(first!.user.id);
  });

  it("claims a wallet-only account instead of forking the human", async () => {
    const guest = await getOrCreateUser({ did: null, wallet: "0xguestwallet00000000" });
    const claimed = await getOrCreateUser({
      did: "did:privy:claimer",
      wallet: "0xguestwallet00000000",
    });
    expect(claimed!.created).toBe(false);
    expect(claimed!.user.id).toBe(guest!.user.id);
    expect(claimed!.user.privy_did).toBe("did:privy:claimer");
  });

  it("moves a shadowed wallet owner back onto their real row", async () => {
    // The 2026-09-21 fork: the wallet's row exists, and a DID-only row was
    // made for the same person while Privy could not name their wallet.
    const real = await getOrCreateUser({ did: null, wallet: "0xshadowedwallet00000" });
    const empty = await getOrCreateUser({ did: "did:privy:shadowed", wallet: null });
    expect(empty!.user.id).not.toBe(real!.user.id);

    const repaired = await getOrCreateUser({
      did: "did:privy:shadowed",
      wallet: "0xshadowedwallet00000",
    });
    expect(repaired!.user.id).toBe(real!.user.id);
    expect(repaired!.user.privy_did).toBe("did:privy:shadowed");
    expect(repaired!.created).toBe(false);

    // The empty row survives with its DID retired, and the next sync is stable.
    const left = (await sql.query(`select privy_did from users where id = $1`, [
      empty!.user.id,
    ])) as { privy_did: string | null }[];
    expect(left[0].privy_did).toBe("retired:did:privy:shadowed");
    const again = await getOrCreateUser({ did: "did:privy:shadowed", wallet: "0xshadowedwallet00000" });
    expect(again!.user.id).toBe(real!.user.id);
  });

  it("never retires a real account's row to repair a fork", async () => {
    // An email user who exported their embedded key and connected it as a
    // wallet: a wallet-only row exists for that address, but their own row
    // is an account with an email, so it must stay theirs.
    const walletRow = await getOrCreateUser({ did: null, wallet: "0xexportedkey00000000" });
    const emailUser = await getOrCreateUser({ did: "did:privy:emailuser", wallet: null });
    await sql.query(`update users set email = 'a@b.c' where id = $1`, [emailUser!.user.id]);

    const after = await getOrCreateUser({ did: "did:privy:emailuser", wallet: "0xexportedkey00000000" });
    expect(after!.user.id).toBe(emailUser!.user.id);
    expect(after!.user.privy_did).toBe("did:privy:emailuser");
    const other = (await sql.query(`select privy_did from users where id = $1`, [
      walletRow!.user.id,
    ])) as { privy_did: string | null }[];
    expect(other[0].privy_did).toBeNull();
  });

  it("never steals an address that belongs to another account", async () => {
    const owner = await getOrCreateUser({ did: null, wallet: "0xownedwallet00000000" });
    const other = await getOrCreateUser({
      did: "did:privy:thief",
      wallet: null,
    });
    // Owner's row now has a DID of its own, so the address can't be claimed…
    await sql.query(`update users set privy_did = 'did:privy:owner' where id = $1`, [
      owner!.user.id,
    ]);
    const attempt = await getOrCreateUser({
      did: "did:privy:thief",
      wallet: "0xownedwallet00000000",
    });
    expect(attempt!.user.id).toBe(other!.user.id);
    expect(attempt!.user.wallet_address).toBeNull();
  });
});

describe("awardXp", () => {
  it("pays a ref-deduped kind once, ever", async () => {
    const user = await freshUser();
    const first = await awardXp(user.id, "pour_in", HASH(1));
    const replay = await awardXp(user.id, "pour_in", HASH(1));
    expect(first.awarded).toBe(XP_ACTIONS.pour_in.amount);
    expect(replay.awarded).toBe(0);
    expect(replay.xp).toBe(first.xp);
  });

  it("one hash can never pay both directions, even across accounts", async () => {
    const alice = await freshUser();
    const bob = await freshUser();
    const inAward = await awardXp(alice.id, "pour_in", HASH(2));
    const outAward = await awardXp(bob.id, "pour_out", HASH(2));
    expect(inAward.awarded).toBe(100);
    expect(outAward.awarded).toBe(0);
  });

  it("once-per-account kinds replay to zero", async () => {
    const user = await freshUser();
    expect((await awardXp(user.id, "account_created", null)).awarded).toBe(25);
    expect((await awardXp(user.id, "account_created", null)).awarded).toBe(0);
  });

  it("parks unannounced awards until the owner's next sync flushes them once", async () => {
    const user = await freshUser();
    await awardXp(user.id, "friend_poured", "some-friend-id", {
      announced: false,
    });
    const news = await flushUnannounced(user.id);
    const again = await flushUnannounced(user.id);
    expect(news).toEqual([
      { kind: "friend_poured", amount: XP_ACTIONS.friend_poured.amount },
    ]);
    expect(again).toEqual([]);
  });
});

describe("referral binding", () => {
  it("bindReferral binds once and refuses self-referral", async () => {
    const referrer = await ensureReferralCode(await freshUser());
    const friend = await freshUser();
    expect(await bindReferral(friend.id, referrer.referral_code!)).toBe(
      referrer.id,
    );
    // Second bind and self-bind both die in the SQL.
    expect(await bindReferral(friend.id, referrer.referral_code!)).toBeNull();
    expect(await bindReferral(referrer.id, referrer.referral_code!)).toBeNull();
  });

  it("claimReferral honours the hatch for a young, unpoured account", async () => {
    const referrer = await ensureReferralCode(await freshUser());
    const friend = await freshUser();
    expect(await claimReferral(friend.id, referrer.referral_code!)).toBe(
      referrer.id,
    );
  });

  it("claimReferral refuses once the account has poured", async () => {
    const referrer = await ensureReferralCode(await freshUser());
    const friend = await freshUser();
    await awardXp(friend.id, "pour_in", HASH(3));
    expect(
      await claimReferral(friend.id, referrer.referral_code!),
    ).toBeNull();
  });

  it("claimReferral refuses outside the 72 hour window", async () => {
    const referrer = await ensureReferralCode(await freshUser());
    const friend = await freshUser();
    await sql.query(
      `update users set created_at = now() - interval '73 hours' where id = $1`,
      [friend.id],
    );
    expect(
      await claimReferral(friend.id, referrer.referral_code!),
    ).toBeNull();
  });

  it("canClaim answers exactly what claimReferral would do", async () => {
    const friend = await freshUser();
    expect((await referralPanel(friend)).canClaim).toBe(true);
    await awardXp(friend.id, "pour_in", HASH(4));
    expect((await referralPanel(friend)).canClaim).toBe(false);
  });
});

describe("referralPanel", () => {
  it("counts seats, pours, banked and steeping XP, and link taps", async () => {
    const referrer = await ensureReferralCode(await freshUser());
    const poured = await freshUser();
    const steeping = await freshUser();
    await bindReferral(poured.id, referrer.referral_code!);
    await bindReferral(steeping.id, referrer.referral_code!);
    // The poured friend's first cup pays the referrer (as xp/pour does).
    await awardXp(referrer.id, "friend_poured", poured.id, {
      announced: false,
    });
    await recordReferralClick(referrer.referral_code!);
    await recordReferralClick(referrer.referral_code!);
    await recordReferralClick("zzzzzzzz"); // unknown code: no row

    const panel = await referralPanel(referrer);
    expect(panel.stats).toEqual({
      taps: 2,
      seated: 2,
      poured: 1,
      earnedXp: XP_ACTIONS.friend_poured.amount,
      steepingXp: XP_ACTIONS.friend_poured.amount,
    });
  });

  it("names the referrer's avatar and rank to the referred, and tracks the paid moment", async () => {
    const referrer = await ensureReferralCode(await freshUser());
    const friend = await freshUser();
    await bindReferral(friend.id, referrer.referral_code!);

    const before = await referralPanel({
      ...friend,
      referred_by: referrer.id,
    });
    expect(before.invitedBy).toMatchObject({ firstPourPaid: false });

    await awardXp(friend.id, "invite_accepted", null);
    const after = await referralPanel({
      ...friend,
      referred_by: referrer.id,
    });
    expect(after.invitedBy).toMatchObject({ firstPourPaid: true });
  });
});

describe("xpHistory", () => {
  it("lists awards newest first with their reasons intact", async () => {
    const user = await freshUser();
    await awardXp(user.id, "account_created", null);
    await awardXp(user.id, "pour_in", HASH(5));
    const events = await xpHistory(user.id);
    expect(events.map((event) => event.kind)).toEqual([
      "pour_in",
      "account_created",
    ]);
    expect(events[0].amount).toBe(XP_ACTIONS.pour_in.amount);
  });
});
