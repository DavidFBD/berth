import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setSqlClient, type SqlClient } from "./db";
import { makeTestDb } from "./pglite-test-db";
import { awardXp } from "./accounts";
import { awardFilledPour } from "./pour-claims";
import { INVITE_STAY_DAYS, INVITE_XP_MONTHLY_CAP, runInviteXpStep, stayedAWeek } from "./invite-xp";
import { DAY, heldWallet, person, seen, username } from "./campaigns/test-kit";
import { XP_ACTIONS } from "@/lib/xp";

/**
 * Invite XP against the real schema (PGlite): the inviter earns
 * friend_stayed for a friend who set up (email, username, wallet) and came
 * back at least six days after setting up, judged a week on; never for a buy,
 * never twice, never for a friend who is not set up, and never on top of
 * a friend_poured already paid under the retired first buy rule.
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

async function friendOf(inviterId: string, { email = true }: { email?: boolean | string } = {}) {
  const friend = await person({ email });
  await sql.query(`update users set referred_by = $2 where id = $1`, [friend.id, inviterId]);
  return friend;
}

async function events(userId: string, kind: string) {
  return (await sql.query(`select ref, amount, announced from xp_events where user_id = $1 and kind = $2`, [userId, kind])) as {
    ref: string;
    amount: number;
    announced: boolean;
  }[];
}

async function setup(friendId: string) {
  return ((await sql.query(`select set_up_at, settled_at, outcome from invite_setups where friend_id = $1`, [friendId])) as {
    set_up_at: Date;
    settled_at: Date | null;
    outcome: string | null;
  }[])[0];
}

const at = (base: Date, days: number) => new Date(base.getTime() + days * DAY);

describe("invite XP for a friend who sets up and stays", () => {
  it("pays the inviter once, a week after the friend set up and came back six days on", async () => {
    const inviter = await person();
    const friend = await friendOf(inviter.id);
    await username(friend);
    const day0 = new Date(Date.now() + 1_000);
    await runInviteXpStep({ now: day0 });
    expect((await setup(friend.id)).outcome).toBeNull();

    // Back six days later; nothing is judged before the week is out.
    await seen(friend, at(day0, 6));
    await runInviteXpStep({ now: at(day0, INVITE_STAY_DAYS - 1) });
    expect(await events(inviter.id, "friend_stayed")).toEqual([]);

    const summary = await runInviteXpStep({ now: at(day0, INVITE_STAY_DAYS) });
    expect(summary.paid).toBe(1);
    expect(await events(inviter.id, "friend_stayed")).toEqual([
      { ref: friend.id, amount: XP_ACTIONS.friend_stayed.amount, announced: false },
    ]);
    expect((await setup(friend.id)).outcome).toBe("paid");

    // Another morning, or a replayed award, pays nothing more.
    await runInviteXpStep({ now: at(day0, INVITE_STAY_DAYS + 1) });
    expect((await awardXp(inviter.id, "friend_stayed", friend.id)).awarded).toBe(0);
    expect(await events(inviter.id, "friend_stayed")).toHaveLength(1);
    const xp = ((await sql.query(`select xp from users where id = $1`, [inviter.id])) as { xp: number }[])[0].xp;
    expect(xp).toBe(
      ((await sql.query(`select coalesce(sum(amount), 0)::int as total from xp_events where user_id = $1`, [inviter.id])) as { total: number }[])[0]
        .total,
    );
  });

  it("pays nothing for a friend whose last visit was before day six, and pays once they are back", async () => {
    const inviter = await person();
    const friend = await friendOf(inviter.id);
    await username(friend);
    const day0 = new Date(Date.now() + 1_000);
    await runInviteXpStep({ now: day0 });
    await seen(friend, at(day0, 2));
    await runInviteXpStep({ now: at(day0, INVITE_STAY_DAYS) });
    expect(await events(inviter.id, "friend_stayed")).toEqual([]);
    await seen(friend, at(day0, 9));
    await runInviteXpStep({ now: at(day0, INVITE_STAY_DAYS + 3) });
    expect(await events(inviter.id, "friend_stayed")).toHaveLength(1);
  });

  it("stayedAWeek: a visit at least six days after set up, nothing earlier", () => {
    const setUp = new Date("2026-10-05T10:00:00Z");
    expect(stayedAWeek(setUp, null)).toBe(false);
    expect(stayedAWeek(setUp, new Date("2026-10-11T09:59:59Z"))).toBe(false);
    expect(stayedAWeek(setUp, new Date("2026-10-11T10:00:00Z"))).toBe(true);
  });

  it("pays nothing for a friend who is not set up: no username, or no email", async () => {
    const inviter = await person();
    const noName = await friendOf(inviter.id);
    const noEmail = await friendOf(inviter.id, { email: false });
    await username(noEmail);
    const day0 = new Date(Date.now() + 1_000);
    await seen(noName, at(day0, 3));
    await seen(noEmail, at(day0, 3));
    await runInviteXpStep({ now: day0 });
    await runInviteXpStep({ now: at(day0, INVITE_STAY_DAYS + 1) });
    expect(await setup(noName.id)).toBeUndefined();
    expect(await setup(noEmail.id)).toBeUndefined();
    expect(await events(inviter.id, "friend_stayed")).toEqual([]);
  });

  it("waits for a friend who set up and never came back, and pays once they do", async () => {
    const inviter = await person();
    const friend = await friendOf(inviter.id);
    await username(friend);
    const day0 = new Date(Date.now() + 1_000);
    await seen(friend, day0);
    await runInviteXpStep({ now: day0 });
    const waiting = await runInviteXpStep({ now: at(day0, INVITE_STAY_DAYS) });
    expect(waiting.waiting).toBeGreaterThanOrEqual(1);
    expect(await events(inviter.id, "friend_stayed")).toEqual([]);
    expect((await setup(friend.id)).settled_at).toBeNull();

    await seen(friend, at(day0, INVITE_STAY_DAYS + 2));
    await runInviteXpStep({ now: at(day0, INVITE_STAY_DAYS + 3) });
    expect(await events(inviter.id, "friend_stayed")).toHaveLength(1);
  });

  it("never pays twice for a friend whose first buy already paid the inviter under the retired rule", async () => {
    const inviter = await person();
    const friend = await friendOf(inviter.id);
    await username(friend);
    await awardXp(inviter.id, "friend_poured", friend.id, { announced: false });
    const day0 = new Date(Date.now() + 1_000);
    await seen(friend, at(day0, 2));
    await runInviteXpStep({ now: day0 });
    expect((await setup(friend.id)).outcome).toBe("paid_before");
    await runInviteXpStep({ now: at(day0, INVITE_STAY_DAYS + 1) });
    expect(await events(inviter.id, "friend_stayed")).toEqual([]);
    expect(await events(inviter.id, "friend_poured")).toHaveLength(1);
  });

  it("closes a friend paid under the old rule on an account later merged into them", async () => {
    const inviter = await person();
    const friend = await friendOf(inviter.id);
    await username(friend);
    const day0 = new Date(Date.now() + 1_000);
    await runInviteXpStep({ now: day0 });
    // An older account of the same person, already paid for, retired into this one.
    const older = await person();
    await awardXp(inviter.id, "friend_poured", older.id, { announced: false });
    await sql.query(`update users set retired_into = $2 where id = $1`, [older.id, friend.id]);
    await seen(friend, at(day0, 6));
    const summary = await runInviteXpStep({ now: at(day0, INVITE_STAY_DAYS) });
    expect(summary.paidBefore).toBeGreaterThanOrEqual(1);
    expect((await setup(friend.id)).outcome).toBe("paid_before");
    expect(await events(inviter.id, "friend_stayed")).toEqual([]);
  });

  it("a friend's buy pays the friend's own invite_accepted and nothing to the inviter", async () => {
    const inviter = await person();
    const friend = await friendOf(inviter.id);
    const { rewards } = await awardFilledPour({ id: friend.id, referred_by: inviter.id }, "pour_in", `0x${"ab".repeat(32)}`);
    expect(rewards.map((reward) => reward.kind).sort()).toEqual(["invite_accepted", "pour_in"]);
    expect(await events(inviter.id, "friend_poured")).toEqual([]);
    expect(await events(inviter.id, "friend_stayed")).toEqual([]);
  });

  it("refuses a self invite: a wallet the inviter also holds, or the same folded email", async () => {
    const inviter = await person({ email: "fold.me.here@gmail.com" });
    const byWallet = await friendOf(inviter.id);
    await heldWallet(byWallet, inviter.home);
    const byEmail = await friendOf(inviter.id, { email: "foldmehere+alt@gmail.com" });
    for (const friend of [byWallet, byEmail]) await username(friend);
    const day0 = new Date(Date.now() + 1_000);
    await runInviteXpStep({ now: day0 });
    for (const friend of [byWallet, byEmail]) await seen(friend, at(day0, 6.5));
    await runInviteXpStep({ now: at(day0, INVITE_STAY_DAYS) });
    expect((await setup(byWallet.id)).outcome).toBe("self_invite");
    expect((await setup(byEmail.id)).outcome).toBe("self_invite");
    expect(await events(inviter.id, "friend_stayed")).toEqual([]);
  });

  it("refuses a friend who was on Berth before the invite (an older account merged in)", async () => {
    const inviter = await person();
    const friend = await friendOf(inviter.id);
    await username(friend);
    const older = await person();
    await sql.query(`update users set created_at = now() - interval '30 days', retired_into = $2 where id = $1`, [older.id, friend.id]);
    const day0 = new Date(Date.now() + 1_000);
    await runInviteXpStep({ now: day0 });
    await seen(friend, at(day0, 6.5));
    await runInviteXpStep({ now: at(day0, INVITE_STAY_DAYS) });
    expect((await setup(friend.id)).outcome).toBe("existing_customer");
    expect(await events(inviter.id, "friend_stayed")).toEqual([]);
  });

  it("pays an inviter for at most ten friends a calendar month; the rest wait for the next", async () => {
    const inviter = await person();
    const friends = [];
    for (let i = 0; i <= INVITE_XP_MONTHLY_CAP; i++) {
      const friend = await friendOf(inviter.id);
      await username(friend);
      friends.push(friend);
    }
    const day0 = new Date(Date.now() + 1_000);
    await runInviteXpStep({ now: day0 });
    for (const friend of friends) await seen(friend, at(day0, 6.5));
    const first = await runInviteXpStep({ now: at(day0, INVITE_STAY_DAYS) });
    expect(first.capped).toBeGreaterThanOrEqual(1);
    expect(await events(inviter.id, "friend_stayed")).toHaveLength(INVITE_XP_MONTHLY_CAP);
    await runInviteXpStep({ now: at(day0, INVITE_STAY_DAYS + 1) });
    expect(await events(inviter.id, "friend_stayed")).toHaveLength(INVITE_XP_MONTHLY_CAP);
    await runInviteXpStep({ now: at(day0, INVITE_STAY_DAYS + 32) });
    expect(await events(inviter.id, "friend_stayed")).toHaveLength(INVITE_XP_MONTHLY_CAP + 1);
  });
});
