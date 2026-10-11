import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setSqlClient, type SqlClient } from "@/lib/server/db";
import { makeTestDb } from "@/lib/server/pglite-test-db";
import { XP_ACTIONS } from "@/lib/xp";
import { FRIEND_FEATURES } from "@/lib/friends-all";
import { mySocial, payFriendsAllIfOn, setAllFriends, setHandle, setLinkFace, setShareHoldings, setShareWeek, setVisible } from "./handles";
import type { SocialViewer } from "./people";
import { runSocialOp } from "./ops";
import { pendingNotices } from "@/lib/server/notices";
import { SOCIAL_NOTICE_ID } from "@/lib/social-proof";

/**
 * "Turn on all friend features" against the real schema (PGlite): every
 * sharing switch on in one statement, the one time XP paid with it, never
 * twice and never taken back, and a card staff hid left hidden.
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

const PAY = XP_ACTIONS.friends_all_on.amount;
const ALL = [...FRIEND_FEATURES];
let n = 0;

async function named(createdAt = new Date().toISOString()): Promise<SocialViewer> {
  n += 1;
  const email = `fa${n}@example.com`;
  const rows = (await sql.query(`insert into users (privy_did, email, created_at) values ($1, $2, $3::timestamptz) returning id`, [`did:privy:fa${n}`, email, createdAt])) as { id: string }[];
  const viewer = { id: rows[0].id, email };
  const saved = await setHandle(viewer, `harbour_${n}`);
  if (!saved.ok) throw new Error("no name");
  return viewer;
}

async function ledger(userId: string): Promise<{ events: number; xp: number }> {
  const rows = (await sql.query(
    `select (select count(*)::int from xp_events where user_id = $1 and kind = 'friends_all_on') as events,
            (select xp from users where id = $1) - (select coalesce(sum(amount), 0)::int from xp_events where user_id = $1 and kind <> 'friends_all_on') as xp`,
    [userId],
  )) as { events: number; xp: number }[];
  return rows[0];
}

describe("setAllFriends", () => {
  it("closes the social notice for good, since the switch it points to is now on (2026-10-11)", async () => {
    const sailor = await named("2026-08-01T00:00:00Z");
    expect(await pendingNotices(sailor.id)).toContain(SOCIAL_NOTICE_ID);
    const result = await setAllFriends(sailor, ALL);
    expect(result.ok).toBe(true);
    expect(await pendingNotices(sailor.id)).not.toContain(SOCIAL_NOTICE_ID);
    // Closed, not merely quiet: it stays closed if sharing is turned off again.
    await setShareHoldings(sailor, false);
    expect(await pendingNotices(sailor.id)).not.toContain(SOCIAL_NOTICE_ID);
  });

  it("still answers a toggle as done when the notice cannot be closed", async () => {
    const sailor = await named("2026-08-01T00:00:00Z");
    await sql.query(`alter table account_notices rename to account_notices_away`);
    try {
      const result = await setAllFriends(sailor, ALL);
      expect(result.ok).toBe(true);
      expect(await setShareHoldings(sailor, true)).not.toBeNull();
    } finally {
      await sql.query(`alter table account_notices_away rename to account_notices`);
    }
  });

  it("says nothing of the switch to an account that already shares its holdings", async () => {
    const sailor = await named("2026-08-01T00:00:00Z");
    await sql.query(`update profiles set share_holdings = true where user_id = $1`, [sailor.id]);
    expect(await pendingNotices(sailor.id)).not.toContain(SOCIAL_NOTICE_ID);
    await sql.query(`update profiles set share_holdings = false where user_id = $1`, [sailor.id]);
    expect(await pendingNotices(sailor.id)).toContain(SOCIAL_NOTICE_ID);
    await setShareHoldings(sailor, true);
    await setShareHoldings(sailor, false);
    expect(await pendingNotices(sailor.id)).not.toContain(SOCIAL_NOTICE_ID);
  });

  it("turns every friend feature on and pays the bonus once, saying so", async () => {
    const sailor = await named();
    await setVisible(sailor, false);
    const result = await setAllFriends(sailor, ALL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.social).toMatchObject({ visible: true, linkFace: true, shareHoldings: true, shareWeek: true, friendsAllClaimed: true });
    expect(result.rewards).toEqual([{ kind: "friends_all_on", amount: PAY }]);
    expect(result.xp).toBeGreaterThanOrEqual(PAY);
    expect(await ledger(sailor.id)).toEqual({ events: 1, xp: PAY });
    const hidden = (await sql.query(`select hidden_at, hidden_handle from profiles where user_id = $1`, [sailor.id])) as { hidden_at: string | null; hidden_handle: string | null }[];
    expect(hidden[0]).toEqual({ hidden_at: null, hidden_handle: null });
  });

  it("takes nothing back when a feature is turned off, and pays nothing for all off and on again", async () => {
    const sailor = await named();
    await setAllFriends(sailor, ALL);
    await setShareWeek(sailor, false);
    await setShareHoldings(sailor, false);
    await setLinkFace(sailor, false);
    await setVisible(sailor, false);
    expect(await ledger(sailor.id)).toEqual({ events: 1, xp: PAY });
    const again = await setAllFriends(sailor, ALL);
    expect(again.ok && again.rewards).toEqual([]);
    expect(again.ok && again.xp).toBeNull();
    expect(again.ok && again.social).toMatchObject({ visible: true, linkFace: true, shareHoldings: true, shareWeek: true });
    expect(await ledger(sailor.id)).toEqual({ events: 1, xp: PAY });
  });

  it("pays once when taps race", async () => {
    const sailor = await named();
    const results = await Promise.all([setAllFriends(sailor, ALL), setAllFriends(sailor, ALL), setAllFriends(sailor, ALL)]);
    expect(results.filter((result) => result.ok && result.rewards.length > 0)).toHaveLength(1);
    expect(await ledger(sailor.id)).toEqual({ events: 1, xp: PAY });
  });

  it("turns on the rest when some are on already", async () => {
    const sailor = await named();
    await setShareWeek(sailor, true);
    const result = await setAllFriends(sailor, ALL);
    expect(result.ok && result.social).toMatchObject({ visible: true, linkFace: true, shareHoldings: true, shareWeek: true });
  });

  it("never shows a card staff hid, and pays nothing while it is hidden", async () => {
    const sailor = await named();
    await sql.query(`update profiles set visible = false, hidden_at = now(), staff_hidden_at = now() where user_id = $1`, [sailor.id]);
    const result = await setAllFriends(sailor, ALL);
    expect(result.ok && result.social).toMatchObject({ visible: false, linkFace: true, shareHoldings: true, shareWeek: true, staffHidden: true });
    expect(result.ok && result.rewards).toEqual([]);
    expect(await ledger(sailor.id)).toEqual({ events: 0, xp: 0 });
    const row = (await sql.query(`select visible, staff_hidden_at is not null as staff from profiles where user_id = $1`, [sailor.id])) as { visible: boolean; staff: boolean }[];
    expect(row[0]).toEqual({ visible: false, staff: true });
  });

  it("asks for a username and a verified email first", async () => {
    n += 1;
    const rows = (await sql.query(`insert into users (privy_did, email) values ($1, $2) returning id`, [`did:privy:fa${n}`, `fa${n}@example.com`])) as { id: string }[];
    expect(await setAllFriends({ id: rows[0].id, email: `fa${n}@example.com` }, ALL)).toEqual({ ok: false, reason: "no username" });
    expect(await setAllFriends({ id: rows[0].id, email: null }, ALL)).toEqual({ ok: false, reason: "email" });
  });

  it("writes an audit line for each switch it moved and one for the act", async () => {
    const sailor = await named();
    await setLinkFace(sailor, true);
    await setAllFriends(sailor, ALL);
    const actions = (await sql.query(`select action from social_audit where actor_id = $1 order by id`, [sailor.id])) as { action: string }[];
    expect(actions.map((row) => row.action)).toEqual(["handle_set", "link_face_on", "share_holdings_on", "share_week_on", "friends_all_on"]);
  });

  it("tells the drawer whether the bonus is claimed", async () => {
    const sailor = await named();
    expect((await mySocial(sailor)).friendsAllClaimed).toBe(false);
    await setAllFriends(sailor, ALL);
    expect((await mySocial(sailor)).friendsAllClaimed).toBe(true);
  });

  it("pays the same bonus, once, when the fourth switch is turned on by hand", async () => {
    const sailor = await named();
    await setLinkFace(sailor, true);
    await setShareHoldings(sailor, true);
    expect(await payFriendsAllIfOn(sailor)).toEqual({ rewards: [], xp: null });
    await setShareWeek(sailor, true);
    const paid = await payFriendsAllIfOn(sailor);
    expect(paid.rewards).toEqual([{ kind: "friends_all_on", amount: PAY }]);
    expect(await ledger(sailor.id)).toEqual({ events: 1, xp: PAY });
    // Off and on again, by hand or with the button: nothing more.
    await setShareWeek(sailor, false);
    await setShareWeek(sailor, true);
    expect(await payFriendsAllIfOn(sailor)).toEqual({ rewards: [], xp: null });
    const button = await setAllFriends(sailor, ALL);
    expect(button.ok && button.rewards).toEqual([]);
    expect(await ledger(sailor.id)).toEqual({ events: 1, xp: PAY });
  });

  it("pays nothing by hand while staff hide the card or without an email", async () => {
    const sailor = await named();
    await setLinkFace(sailor, true);
    await setShareHoldings(sailor, true);
    await setShareWeek(sailor, true);
    await sql.query(`update profiles set staff_hidden_at = now() where user_id = $1`, [sailor.id]);
    expect((await payFriendsAllIfOn(sailor)).rewards).toEqual([]);
    await sql.query(`update profiles set staff_hidden_at = null where user_id = $1`, [sailor.id]);
    expect((await payFriendsAllIfOn({ id: sailor.id, email: null })).rewards).toEqual([]);
    expect(await ledger(sailor.id)).toEqual({ events: 0, xp: 0 });
  });

  it("says the bonus beside the social state when a switch op completes all four", async () => {
    const sailor = await named();
    const caller = { viewer: sailor, anonKey: "k" };
    await runSocialOp("link-face", { on: true }, caller);
    await runSocialOp("share-holdings", { on: true }, caller);
    const last = (await runSocialOp("share-week", { on: true }, caller)).body as { rewards?: unknown; friendsAllClaimed?: boolean };
    expect(last.rewards).toEqual([{ kind: "friends_all_on", amount: PAY }]);
    expect(last.friendsAllClaimed).toBe(true);
    const off = (await runSocialOp("share-week", { on: false }, caller)).body as { rewards?: unknown };
    expect(off.rewards).toBeUndefined();
  });

  it("refuses a list of features that is not the one it turns on, and records the one shown", async () => {
    const sailor = await named();
    expect(await setAllFriends(sailor, ["visible", "linkFace", "shareHoldings"])).toEqual({ ok: false, reason: "features" });
    expect(await setAllFriends(sailor, [...ALL, "somethingNew"])).toEqual({ ok: false, reason: "features" });
    expect(await setAllFriends(sailor, undefined)).toEqual({ ok: false, reason: "features" });
    expect((await mySocial(sailor)).shareWeek).toBe(false);
    expect(await ledger(sailor.id)).toEqual({ events: 0, xp: 0 });
    await setAllFriends(sailor, [...ALL].reverse());
    const meta = (await sql.query(`select meta from social_audit where actor_id = $1 and action = 'friends_all_on'`, [sailor.id])) as { meta: { shown: string } }[];
    expect(meta[0].meta.shown.split(",").sort()).toEqual([...ALL].sort());
  });

  it("answers a stale offer with 409, so the client reads the state again", async () => {
    const sailor = await named();
    const answer = await runSocialOp("friends-all", { features: ["visible"] }, { viewer: sailor, anonKey: "k" });
    expect(answer.status).toBe(409);
  });
});
