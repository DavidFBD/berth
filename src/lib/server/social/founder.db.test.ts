import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setSqlClient, type SqlClient } from "@/lib/server/db";
import { makeTestDb } from "@/lib/server/pglite-test-db";
import { readFirstPath } from "@/lib/server/first-path";
import { friendsHolding } from "@/lib/server/social-proof";
import { FIRST_FRIEND_NOTICE_ID } from "@/lib/social-proof";

const notices = vi.hoisted(() => ({ sent: [] as { userId: string; notice: { type: string } }[] }));
vi.mock("@/lib/server/email/notify", () => ({
  sendNotice: vi.fn((input: { userId: string; notice: { type: string } }) => {
    notices.sent.push(input);
  }),
}));

const { setBlock } = await import("./blocks");
const { friendsBoard } = await import("./board");
const { readCardOf } = await import("./cards");
const { FRIENDS_MAX, friendAction, listFriends } = await import("./friends");
const { activeFounderId, firstFriendOffer } = await import("./founder");
const { setHandle, setShareHoldings, setVisible } = await import("./handles");
const { runSocialOp } = await import("./ops");

/**
 * The founder as a ready-made first friend
 * (docs/plans/2026-10-13-first-friend-nudge.md), against the real schema:
 * no approval, the cap lifted on his side only, no pay of any kind, off his
 * friends' boards, and an offer that closes for good.
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

let n = 0;
type Person = { id: string; email: string | null; name: string };

async function person(name?: string): Promise<Person> {
  n += 1;
  const email = `f${n}@example.com`;
  const rows = (await sql.query(`insert into users (privy_did, email) values ($1, $2) returning id`, [`did:privy:f${n}`, email])) as { id: string }[];
  const viewer = { id: rows[0].id, email, name: name ?? "" };
  if (name) {
    const set = await setHandle(viewer, name);
    if (!set.ok) throw new Error(`could not name ${name}: ${set.reason}`);
  }
  return viewer;
}

let founder: Person;
let founders = 0;

/** A fresh founder per test: named by the env var, his profile uncapped. */
beforeEach(async () => {
  founders += 1;
  founder = await person(`founder_${founders}`);
  await sql.query(`update profiles set friends_uncapped = true where user_id = $1`, [founder.id]);
  vi.stubEnv("BERTH_FOUNDER_USER_ID", founder.id);
  notices.sent.length = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const addFounder = (viewer: Person) => friendAction(viewer, "request", { handle: founder.name });

async function pair(a: string, b: string) {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  await sql.query(`insert into friends (a_id, b_id) values ($1, $2)`, [lo, hi]);
}

describe("the founder", () => {
  it("is off while the env var is unset, or his profile is not uncapped", async () => {
    vi.stubEnv("BERTH_FOUNDER_USER_ID", "");
    expect(await activeFounderId()).toBeNull();
    vi.stubEnv("BERTH_FOUNDER_USER_ID", founder.id);
    expect(await activeFounderId()).toBe(founder.id);
    await sql.query(`update profiles set friends_uncapped = false where user_id = $1`, [founder.id]);
    expect(await activeFounderId()).toBeNull();
    // Off, a request to him is an ordinary one, waiting for his answer.
    const sailor = await person("plain_sailor");
    expect((await firstFriendOffer(sailor)).offer).toBeNull();
    const result = await addFounder(sailor);
    expect(result.done).toBe(true);
    expect(result.card.found && result.card.viewer.relation).toBe("sent");
  });

  it("makes friends at once: no request row, no email notice, one audit row", async () => {
    const sailor = await person("quick_sailor");
    const result = await addFounder(sailor);
    expect(result.done).toBe(true);
    expect(result.card.found && result.card.viewer.relation).toBe("friends");
    expect(await sql.query(`select 1 from friend_requests where from_id = $1 or to_id = $1`, [sailor.id])).toHaveLength(0);
    expect(notices.sent).toHaveLength(0);
    expect(await sql.query(`select 1 from social_audit where actor_id = $1 and action = 'friend_founder'`, [sailor.id])).toHaveLength(1);
    // Asking again changes nothing.
    expect((await addFounder(sailor)).done).toBe(false);
  });

  it("settles a request already waiting for him", async () => {
    vi.stubEnv("BERTH_FOUNDER_USER_ID", "");
    const sailor = await person("early_sailor");
    await addFounder(sailor);
    vi.stubEnv("BERTH_FOUNDER_USER_ID", founder.id);
    const result = await addFounder(sailor);
    expect(result.card.found && result.card.viewer.relation).toBe("friends");
    expect(await sql.query(`select status from friend_requests where from_id = $1`, [sailor.id])).toEqual([{ status: "accepted" }]);
  });

  it("is stopped by a block either way and by his earlier decline", async () => {
    const blocker = await person("blocking_sailor");
    await setBlock(blocker, founder.name, true);
    expect((await addFounder(blocker)).done).toBe(false);

    const blocked = await person("blocked_sailor");
    await setBlock(founder, blocked.name, true);
    expect((await addFounder(blocked)).done).toBe(false);
    expect((await firstFriendOffer(blocked)).offer).toBeNull();

    // He declined this account before the feature: that answer stands.
    vi.stubEnv("BERTH_FOUNDER_USER_ID", "");
    const declined = await person("declined_sailor");
    await addFounder(declined);
    await friendAction(founder, "decline", { handle: declined.name });
    await friendAction(declined, "cancel", { handle: founder.name });
    vi.stubEnv("BERTH_FOUNDER_USER_ID", founder.id);
    expect((await addFounder(declined)).done).toBe(false);
    expect((await firstFriendOffer(declined)).offer).toBeNull();
    expect((await listFriends(declined)).friends).toHaveLength(0);
  });

  it("takes friends past the cap, while the asker's own cap still holds", async () => {
    for (let i = 0; i < FRIENDS_MAX; i++) await pair(founder.id, (await person()).id);
    const late = await person("late_sailor");
    expect((await addFounder(late)).done).toBe(true);
    expect(await sql.query(`select count(*)::int as n from friends where a_id = $1 or b_id = $1`, [founder.id])).toEqual([{ n: FRIENDS_MAX + 1 }]);

    const full = await person("full_sailor");
    for (let i = 0; i < FRIENDS_MAX; i++) await pair(full.id, (await person()).id);
    expect((await addFounder(full)).done).toBe(false);
    // The database says the same, past the app's own count.
    await expect(pair(full.id, founder.id)).rejects.toThrow(/friends cap reached/);
  });

  it("pays nothing: no XP, no campaign claim, no referral, and the invite step stays open", async () => {
    const sailor = await person("unpaid_sailor");
    expect((await addFounder(sailor)).done).toBe(true);
    expect(await sql.query(`select 1 from xp_events where user_id = any($1::uuid[]) and kind not in ('username_set')`, [[sailor.id, founder.id]])).toHaveLength(0);
    expect(await sql.query(`select 1 from campaign_claims where user_id = any($1::uuid[])`, [[sailor.id, founder.id]])).toHaveLength(0);
    expect(await sql.query(`select referred_by from users where id = $1`, [sailor.id])).toEqual([{ referred_by: null }]);
    expect((await readFirstPath(sailor.id))?.facts.inviteSent).toBe(false);
    // Any other friend does close the step.
    const other = await person("other_sailor");
    await pair(sailor.id, other.id);
    expect((await readFirstPath(sailor.id))?.facts.inviteSent).toBe(true);
  });

  it("is left off his friends' boards, and keeps his own", async () => {
    const sailor = await person("board_sailor");
    const mate = await person("board_mate");
    await addFounder(sailor);
    await pair(sailor.id, mate.id);
    expect((await friendsBoard(sailor)).rows.map((row) => row.handle).sort()).toEqual(["board_mate", "board_sailor"]);
    expect((await friendsBoard(founder)).rows.map((row) => row.handle)).toContain("board_sailor");
  });

  it("says on his card and in Your friends hold that his holdings are not advice", async () => {
    const sailor = await person("sharing_sailor");
    await addFounder(sailor);
    await setShareHoldings(founder, true);
    await setShareHoldings(sailor, true);
    await sql.query(
      `insert into portfolio_days (user_id, day, value_usd, holdings, source, as_of) values ($1, current_date, 1, $2::jsonb, 'snapshot', now())`,
      [founder.id, JSON.stringify([{ symbol: "NVDA", quantity: 2, price: 180, source: "mark" }])],
    );
    const card = await readCardOf(sailor, founder.id);
    expect(card.found && card.card.founder).toBe(true);
    expect(card.found && card.holds).toEqual(["NVDA"]);
    // Names only: the card carries no amount anywhere.
    expect(JSON.stringify(card)).not.toMatch(/quantity|value_usd|360/);
    expect((await friendsHolding(sailor)).holding).toEqual([expect.objectContaining({ symbol: "NVDA", founder: true })]);
    // His own card, to himself, is no founder card.
    const own = await readCardOf(founder, founder.id);
    expect(own.found && own.card.founder).toBeUndefined();
  });
});

describe("the first friend offer", () => {
  it("is offered to any account with no friends, whatever its age", async () => {
    const sailor = await person("new_sailor");
    expect((await firstFriendOffer(sailor)).offer).toEqual({ handle: founder.name, avatarId: null, xp: expect.any(Number) });
    const answer = await runSocialOp("first-friend", {}, { viewer: sailor, anonKey: "x" });
    expect(answer).toEqual({ status: 200, body: { offer: expect.objectContaining({ handle: founder.name }) } });
    // Never to the founder himself, nor without a username.
    expect((await firstFriendOffer(founder)).offer).toBeNull();
    expect((await firstFriendOffer(await person())).offer).toBeNull();
  });

  it("is gone while he hides, or while staff hide him", async () => {
    const sailor = await person("watching_sailor");
    await setVisible(founder, false);
    expect((await firstFriendOffer(sailor)).offer).toBeNull();
    await setVisible(founder, true);
    expect((await firstFriendOffer(sailor)).offer).not.toBeNull();
    await sql.query(`update profiles set staff_hidden_at = now() where user_id = $1`, [founder.id]);
    expect((await firstFriendOffer(sailor)).offer).toBeNull();
  });

  it("closes for good on Not now", async () => {
    const sailor = await person("busy_sailor");
    expect(await runSocialOp("notice-seen", { notice: FIRST_FRIEND_NOTICE_ID }, { viewer: sailor, anonKey: "x" })).toEqual({ status: 200, body: { ok: true } });
    expect((await firstFriendOffer(sailor)).offer).toBeNull();
  });

  it("closes for good with any first friend, even one removed later", async () => {
    const sailor = await person("social_sailor");
    const mate = await person("social_mate");
    await friendAction(sailor, "request", { handle: mate.name });
    // A live request out is enough to wait.
    expect((await firstFriendOffer(sailor)).offer).toBeNull();
    await friendAction(mate, "accept", { handle: sailor.name });
    await friendAction(sailor, "remove", { handle: mate.name });
    expect((await listFriends(sailor)).friends).toHaveLength(0);
    expect((await firstFriendOffer(sailor)).offer).toBeNull();

    // Adding the founder closes it as well.
    const other = await person("founder_fan");
    await addFounder(other);
    await friendAction(other, "remove", { handle: founder.name });
    expect((await firstFriendOffer(other)).offer).toBeNull();
  });
});
