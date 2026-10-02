import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setSqlClient, type SqlClient } from "@/lib/server/db";
import { makeTestDb } from "@/lib/server/pglite-test-db";
import { listBlocked, report, setBlock } from "./blocks";
import { friendsBoard } from "./board";
import { NOT_FOUND, readCard } from "./cards";
import { DAILY_REQUEST_MAX, DECLINE_QUIET_DAYS, OUTGOING_MAX, FRIENDS_MAX, friendAction, friendLink, listFriends, readLinkCard } from "./friends";
import { checkHandle, mySocial, setHandle, setVisible } from "./handles";
import { runSocialOp } from "./ops";
import type { SocialViewer } from "./people";
import { XP_ACTIONS } from "@/lib/xp";
import { setSalute } from "./salutes";

/**
 * Social phase 1 against the real schema (PGlite): the username rules, the
 * one answer for every card that cannot be shown, Salutes, the friend state
 * machine, blocks, friend links and the friends board's arithmetic.
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
/** A fresh account; with a username when `name` is given (which needs the email). */
async function person(name?: string, { email = true, createdAt }: { email?: boolean; createdAt?: string } = {}): Promise<SocialViewer & { name: string }> {
  n += 1;
  const rows = (await sql.query(
    `insert into users (privy_did, email, created_at) values ($1, $2, coalesce($3::timestamptz, now())) returning id`,
    [`did:privy:${n}`, email ? `p${n}@example.com` : null, createdAt ?? null],
  )) as { id: string }[];
  const viewer = { id: rows[0].id, email: email ? `p${n}@example.com` : null, name: name ?? "" };
  if (name) {
    const set = await setHandle(viewer, name);
    if (!set.ok) throw new Error(`could not name ${name}: ${set.reason}`);
  }
  return viewer;
}

const DAY = 86_400_000;
const daysFrom = (base: Date, days: number) => new Date(base.getTime() + days * DAY);

describe("usernames", () => {
  it("need a verified email", async () => {
    const walletOnly = await person(undefined, { email: false });
    expect(await checkHandle(walletOnly, "sailor")).toEqual({ ok: false, reason: "noEmail" });
    expect(await setHandle(walletOnly, "sailor")).toEqual({ ok: false, reason: "noEmail" });
    expect((await mySocial(walletOnly)).hasEmail).toBe(false);
  });

  it("are unique on the fold: case and lookalikes collide", async () => {
    await person("Harbour_Light");
    const other = await person();
    expect(await checkHandle(other, "harbour_light")).toEqual({ ok: false, reason: "taken" });
    expect(await checkHandle(other, "HARB0URLIGHT")).toEqual({ ok: false, reason: "taken" });
    expect(await setHandle(other, "harb0ur__light")).toEqual({ ok: false, reason: "taken" });
    expect(await checkHandle(other, "harbour_lights")).toEqual({ ok: true, handle: "harbour_lights" });
  });

  it("refuse the shape, reserved and offensive names, and never say reserved", async () => {
    const someone = await person();
    expect(await checkHandle(someone, "ab")).toEqual({ ok: false, reason: "short" });
    expect(await checkHandle(someone, "no spaces")).toEqual({ ok: false, reason: "charset" });
    expect(await checkHandle(someone, "_edge")).toEqual({ ok: false, reason: "edge" });
    expect(await checkHandle(someone, "Berth")).toEqual({ ok: false, reason: "taken" });
    expect(await checkHandle(someone, "Harbour_Master")).toEqual({ ok: false, reason: "taken" });
    expect(await checkHandle(someone, "big_ass")).toEqual({ ok: false, reason: "offensive" });
  });

  it("turn the card on with the first pick", async () => {
    const mira = await person("Mira");
    expect(await mySocial(mira)).toEqual({ hasEmail: true, handle: "mira", visible: true, linkFace: false, shareHoldings: false, nextChangeAt: expect.any(String), requests: 0 });
  });

  it("change once per 30 days; typed in capitals, a name is the same lowercase name", async () => {
    const start = new Date("2026-09-01T10:00:00Z");
    const sailor = await person();
    expect((await setHandle(sailor, "tide_one", start)).ok).toBe(true);
    expect(await setHandle(sailor, "tide_two", daysFrom(start, 10))).toEqual({ ok: false, reason: "cooldown" });
    const recased = await setHandle(sailor, "Tide_One", daysFrom(start, 10));
    expect(recased.ok && recased.social.handle).toBe("tide_one");
    // A lookalike of the same fold is still a change, and waits its turn.
    expect(await setHandle(sailor, "tide_0ne", daysFrom(start, 10))).toEqual({ ok: false, reason: "cooldown" });
    const changed = await setHandle(sailor, "tide_two", daysFrom(start, 31));
    expect(changed.ok && changed.social.handle).toBe("tide_two");
  });

  it("hold a dropped name 90 days for its last owner", async () => {
    const start = new Date("2026-09-01T10:00:00Z");
    const first = await person();
    await setHandle(first, "old_mooring", start);
    await setHandle(first, "new_mooring", daysFrom(start, 31));
    const second = await person();
    expect(await checkHandle(second, "old_mooring", daysFrom(start, 40))).toEqual({ ok: false, reason: "taken" });
    // Its last owner may take it back once the 30 days allow a change.
    const back = await setHandle(first, "old_mooring", daysFrom(start, 62));
    expect(back.ok).toBe(true);
    // And a hold that ran out frees the name.
    const third = await person();
    await setHandle(third, "brief_name", start);
    await setHandle(third, "other_name", daysFrom(start, 31));
    expect(await checkHandle(second, "brief_name", daysFrom(start, 31 + 91))).toEqual({ ok: true, handle: "brief_name" });
  });

  it("a race for one name ends with one owner", async () => {
    const [a, b] = [await person(), await person()];
    const results = await Promise.all([setHandle(a, "same_name"), setHandle(b, "Same_Name")]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toEqual({ ok: false, reason: "taken" });
  });
});

describe("the card", () => {
  it("shows only the card fields", async () => {
    await person("quay_keeper", { createdAt: "2026-07-14T08:00:00Z" });
    const answer = await readCard(await person(), "Quay_Keeper");
    expect(answer).toEqual({
      found: true,
      card: { handle: "quay_keeper", avatarId: null, xp: XP_ACTIONS.username_set.amount, memberSince: "2026-07", salutes: 0 },
      viewer: { relation: "none", saluted: false, hasEmail: true, hasHandle: false },
    });
    const keys = answer.found ? Object.keys(answer.card).sort() : [];
    expect(keys).toEqual(["avatarId", "handle", "memberSince", "salutes", "xp"]);
  });

  it("answers missing, hidden, blocked, blocking and malformed identically", async () => {
    const viewer = await person("looker");
    const hidden = await person("hidden_one");
    await setVisible(hidden, false);
    const blocksViewer = await person("wall_builder");
    await setBlock(blocksViewer, "looker", true);
    const blockedByViewer = await person("walled_off");
    await setBlock(viewer, "walled_off", true);

    const answers = await Promise.all(
      ["nobody_here", "hidden_one", "wall_builder", "walled_off", "x", "%%%"].map((name) => readCard(viewer, name)),
    );
    for (const answer of answers) {
      expect(answer).toEqual(NOT_FOUND);
      expect(JSON.stringify(answer)).toBe('{"found":false}');
    }
    // The same through the route table: status and body.
    const viaOps = await Promise.all(
      ["nobody_here", "hidden_one", "wall_builder", "walled_off"].map((handle) =>
        runSocialOp("card", { handle }, { viewer, anonKey: "k" }),
      ),
    );
    expect(new Set(viaOps.map((result) => JSON.stringify(result))).size).toBe(1);
    // Signed out, every name is one answer, a visible one included.
    const signedOut = await Promise.all(
      ["looker", "hidden_one", "wall_builder", "nobody_there", "%%%"].map((handle) => runSocialOp("card", { handle }, { viewer: null, anonKey: "k" })),
    );
    for (const result of signedOut) expect(result).toEqual({ status: 200, body: { found: false, signIn: true } });
    void blockedByViewer;
  });

  it("goes off while the account has no verified email, and back when it has one", async () => {
    const viewer = await person("email_watcher");
    const owner = await person("email_owner");
    const friend = await person("email_friend");
    await friendAction(owner, "request", { handle: "email_friend" });
    await friendAction(friend, "accept", { handle: "email_owner" });
    await sql.query(`update users set email = null where id = $1`, [owner.id]);
    expect(await readCard(viewer, "email_owner")).toEqual(NOT_FOUND);
    expect(await setSalute(viewer, "email_owner", true)).toEqual(NOT_FOUND);
    expect((await friendsBoard(friend)).rows.map((row) => row.handle)).toEqual(["email_friend"]);
    expect((await listFriends(friend)).friends[0]).toMatchObject({ handle: "email_owner", hidden: true });
    // Friends keep the name it had when the email went, even if it changes.
    await sql.query(`update handles set handle = 'renamed_quietly', handle_norm = 'renamedquietly' where user_id = $1`, [owner.id]);
    expect((await listFriends(friend)).friends[0]).toEqual({ handle: "email_owner", avatarId: null, xp: 0, hidden: true });
    await sql.query(`update handles set handle = 'email_owner', handle_norm = 'emailowner' where user_id = $1`, [owner.id]);
    // The username is kept, and the card comes back with a verified email.
    expect((await mySocial({ ...owner, email: null })).handle).toBe("email_owner");
    await sql.query(`update users set email = 'back@example.com' where id = $1`, [owner.id]);
    expect((await readCard(viewer, "email_owner")).found).toBe(true);
    const stored = (await sql.query(`select hidden_handle from profiles where user_id = $1`, [owner.id])) as { hidden_handle: string | null }[];
    expect(stored[0].hidden_handle).toBeNull();
  });

  it("an owner still sees their own hidden card", async () => {
    const shy = await person("shy_one");
    await setVisible(shy, false);
    const own = await readCard(shy, "shy_one");
    expect(own.found && own.viewer?.relation).toBe("self");
  });

  it("a lookalike reaches the one owner", async () => {
    await person("sail0r");
    const answer = await readCard(await person(), "SAILOR");
    expect(answer.found && answer.card.handle).toBe("sail0r");
  });
});

describe("Salutes", () => {
  it("one per giver, revocable, and a re-salute keeps its first date", async () => {
    const giver = await person("giver");
    const star = await person("star");
    const saluted = await setSalute(giver, "star", true);
    expect(saluted.found && saluted.card.salutes).toBe(1);
    expect(saluted.found && saluted.viewer?.saluted).toBe(true);
    await setSalute(giver, "star", true);
    const first = ((await sql.query(`select first_at from salutes where giver_id = $1`, [giver.id])) as { first_at: string }[])[0];
    const revoked = await setSalute(giver, "star", false);
    expect(revoked.found && revoked.card.salutes).toBe(0);
    const again = await setSalute(giver, "star", true);
    expect(again.found && again.card.salutes).toBe(1);
    const after = ((await sql.query(`select first_at from salutes where giver_id = $1`, [giver.id])) as { first_at: string }[])[0];
    expect(new Date(after.first_at).getTime()).toBe(new Date(first.first_at).getTime());
    void star;
  });

  it("need a verified email, and never to oneself", async () => {
    const walletOnly = await person(undefined, { email: false });
    await person("unsaluted");
    const result = await setSalute(walletOnly, "unsaluted", true);
    expect(result.found && result.card.salutes).toBe(0);
    const self = await person("vain");
    const own = await setSalute(self, "vain", true);
    expect(own.found && own.card.salutes).toBe(0);
  });

  it("give no XP", async () => {
    const giver = await person("xp_giver");
    const star = await person("xp_star");
    await setSalute(giver, "xp_star", true);
    const xp = (await sql.query(`select id, xp from users where id in ($1, $2)`, [giver.id, star.id])) as { xp: number }[];
    // Only what each username paid; the Salute itself pays nothing.
    expect(xp.every((row) => row.xp === XP_ACTIONS.username_set.amount)).toBe(true);
    expect(await sql.query(`select * from xp_events where user_id in ($1, $2) and kind <> 'username_set'`, [giver.id, star.id])).toEqual([]);
  });

  it("cannot reach a hidden card", async () => {
    const giver = await person("hidden_fan");
    const hidden = await person("gone_quiet");
    await setVisible(hidden, false);
    expect(await setSalute(giver, "gone_quiet", true)).toEqual(NOT_FOUND);
    expect(await sql.query(`select * from salutes where recipient_id = $1`, [hidden.id])).toEqual([]);
  });
});

describe("friends", () => {
  const relation = async (viewer: SocialViewer, handle: string) => {
    const card = await readCard(viewer, handle);
    return card.found ? card.viewer?.relation : "not found";
  };

  it("request, cancel", async () => {
    const a = await person("ask_a");
    await person("ask_b");
    expect(await relation(a, "ask_b")).toBe("none");
    const sent = await friendAction(a, "request", { handle: "ask_b" });
    expect(sent.done).toBe(true);
    expect(sent.card.found && sent.card.viewer?.relation).toBe("sent");
    expect((await friendAction(a, "cancel", { handle: "ask_b" })).done).toBe(true);
    expect(await relation(a, "ask_b")).toBe("none");
  });

  it("received, accept, remove", async () => {
    const a = await person("acc_a");
    const b = await person("acc_b");
    await friendAction(a, "request", { handle: "acc_b" });
    expect(await relation(b, "acc_a")).toBe("received");
    expect((await mySocial(b)).requests).toBe(1);
    expect((await listFriends(b)).incoming.map((p) => p.handle)).toEqual(["acc_a"]);
    const accepted = await friendAction(b, "accept", { handle: "acc_a" });
    expect(accepted.card.found && accepted.card.viewer?.relation).toBe("friends");
    expect(await relation(a, "acc_b")).toBe("friends");
    expect((await listFriends(a)).friends.map((p) => p.handle)).toEqual(["acc_b"]);
    await friendAction(a, "remove", { handle: "acc_b" });
    expect(await relation(b, "acc_a")).toBe("none");
    expect((await listFriends(b)).friends).toEqual([]);
  });

  it("asking someone who asked you makes you friends", async () => {
    const a = await person("cross_a");
    const b = await person("cross_b");
    await friendAction(a, "request", { handle: "cross_b" });
    await friendAction(b, "request", { handle: "cross_a" });
    expect(await relation(a, "cross_b")).toBe("friends");
  });

  it("a decline is silent, and cancelling then asking again stays silent", async () => {
    const a = await person("pest_a");
    const b = await person("pest_b");
    await friendAction(a, "request", { handle: "pest_b" });
    await friendAction(b, "decline", { handle: "pest_a" });
    expect(await relation(a, "pest_b")).toBe("sent");
    expect(await relation(b, "pest_a")).toBe("none");
    expect((await listFriends(b)).incoming).toEqual([]);
    await friendAction(a, "cancel", { handle: "pest_b" });
    const again = await friendAction(a, "request", { handle: "pest_b" });
    expect(again.card.found && again.card.viewer?.relation).toBe("sent");
    expect((await listFriends(b)).incoming).toEqual([]);
    expect((await mySocial(b)).requests).toBe(0);
    // After the quiet days a request knocks again.
    await friendAction(a, "cancel", { handle: "pest_b" });
    await sql.query(`update friend_requests set responded_at = now() - make_interval(days => $2::int) where from_id = $1`, [
      a.id,
      DECLINE_QUIET_DAYS + 1,
    ]);
    await friendAction(a, "request", { handle: "pest_b" });
    expect((await listFriends(b)).incoming.map((p) => p.handle)).toEqual(["pest_a"]);
  });

  it(`stop a cancel and ask again loop at ${DAILY_REQUEST_MAX} requests a day`, async () => {
    const a = await person("looper");
    const b = await person("loop_target");
    await friendAction(a, "request", { handle: "loop_target" });
    await friendAction(b, "decline", { handle: "looper" });
    for (let i = 1; i < DAILY_REQUEST_MAX; i++) {
      await friendAction(a, "cancel", { handle: "loop_target" });
      expect((await friendAction(a, "request", { handle: "loop_target" })).done).toBe(true);
    }
    await friendAction(a, "cancel", { handle: "loop_target" });
    expect((await friendAction(a, "request", { handle: "loop_target" })).done).toBe(false);
    // A day later the count is fresh.
    await sql.query(`update friend_requests set created_at = now() - interval '25 hours' where from_id = $1`, [a.id]);
    expect((await friendAction(a, "request", { handle: "loop_target" })).done).toBe(true);
  });

  it("the one who declined can still say yes by asking", async () => {
    const a = await person("late_a");
    const b = await person("late_b");
    await friendAction(a, "request", { handle: "late_b" });
    await friendAction(b, "decline", { handle: "late_a" });
    await friendAction(b, "request", { handle: "late_a" });
    expect(await relation(a, "late_b")).toBe("friends");
  });

  it("need a username and a verified email to ask", async () => {
    const nameless = await person();
    await person("wanted");
    expect((await friendAction(nameless, "request", { handle: "wanted" })).done).toBe(false);
    const walletOnly = await person(undefined, { email: false });
    expect((await friendAction(walletOnly, "request", { handle: "wanted" })).done).toBe(false);
  });

  it("cannot ask a hidden card, and the answer is the card's", async () => {
    const a = await person("seeker");
    const hidden = await person("hermit");
    await setVisible(hidden, false);
    expect(await friendAction(a, "request", { handle: "hermit" })).toEqual({ done: false, card: NOT_FOUND });
    expect(await friendAction(a, "request", { handle: "no_such_person" })).toEqual({ done: false, card: NOT_FOUND });
  });

  it(`hold at ${OUTGOING_MAX} open requests`, async () => {
    const eager = await person("eager");
    for (let i = 0; i < OUTGOING_MAX; i++) {
      await person(`target_${i}`);
      expect((await friendAction(eager, "request", { handle: `target_${i}` })).done).toBe(true);
    }
    await person("one_too_many");
    expect((await friendAction(eager, "request", { handle: "one_too_many" })).done).toBe(false);
  });

  it(`hold at ${FRIENDS_MAX} friends`, async () => {
    const popular = await person("popular");
    const ids: string[] = [];
    for (let i = 0; i < FRIENDS_MAX; i++) ids.push((await person()).id);
    await sql.query(
      `insert into friends (a_id, b_id) select least($1::uuid, x), greatest($1::uuid, x) from unnest($2::uuid[]) as x`,
      [popular.id, ids],
    );
    const late = await person("late_friend");
    await friendAction(late, "request", { handle: "popular" });
    expect((await friendAction(popular, "accept", { handle: "late_friend" })).done).toBe(false);
    // The database holds the cap itself, whatever the code checked before.
    await expect(
      sql.query(`insert into friends (a_id, b_id) select least($1::uuid, $2::uuid), greatest($1::uuid, $2::uuid)`, [popular.id, late.id]),
    ).rejects.toThrow(/friends cap reached/);
    expect(((await sql.query(`select count(*)::int as n from friends where a_id = $1 or b_id = $1`, [popular.id])) as { n: number }[])[0].n).toBe(FRIENDS_MAX);
    // And the request stays unanswered rather than accepted without a pair.
    const status = (await sql.query(`select status from friend_requests where from_id = $1`, [late.id])) as { status: string }[];
    expect(status[0].status).toBe("pending");
  });

  it("nobody reads another person's friends: the card carries none", async () => {
    const a = await person("private_a");
    const b = await person("private_b");
    await friendAction(a, "request", { handle: "private_b" });
    await friendAction(b, "accept", { handle: "private_a" });
    const stranger = await person("stranger");
    const card = await readCard(stranger, "private_a");
    expect(JSON.stringify(card)).not.toContain("private_b");
    expect(card.found && Object.keys(card.card)).not.toContain("friends");
  });
});

describe("a friend who hides", () => {
  it("shows in lists only as the name they had, with no face, XP or new name", async () => {
    const a = await person("lister");
    const b = await person("Veiled_Friend");
    const c = await person("veiled_asked");
    await sql.query(`update users set avatar_id = 'buoy', xp = 900 where id = $1`, [b.id]);
    await friendAction(a, "request", { handle: "Veiled_Friend" });
    await friendAction(b, "accept", { handle: "lister" });
    await friendAction(a, "request", { handle: "veiled_asked" });
    await setVisible(b, false);
    await setVisible(c, false);
    await sql.query(`update handles set handle = 'new_face', handle_norm = 'newface' where user_id = $1`, [b.id]);
    const list = await listFriends(a);
    expect(list.friends).toEqual([{ handle: "veiled_friend", avatarId: null, xp: 0, hidden: true }]);
    expect(list.outgoing).toEqual([{ handle: "veiled_asked", avatarId: null, xp: 0, hidden: true }]);
    expect(JSON.stringify(list)).not.toContain("new_face");
    // Back on: the name they go by, face and XP again.
    await setVisible(b, true);
    expect((await listFriends(a)).friends).toEqual([{ handle: "new_face", avatarId: "buoy", xp: 900 }]);
  });
});

describe("friend links", () => {
  it("open the owner's card and file a request via the link", async () => {
    const owner = await person("link_owner");
    const token = (await friendLink(owner))!;
    expect(token).toMatch(/^[a-z2-9]{12}$/);
    expect(await friendLink(owner)).toBe(token);
    const visitor = await person("link_visitor");
    const card = await readLinkCard(visitor, token);
    expect(card.found && card.card.handle).toBe("link_owner");
    const sent = await friendAction(visitor, "request", { token });
    expect(sent.done).toBe(true);
    const via = (await sql.query(`select via from friend_requests where from_id = $1`, [visitor.id])) as { via: string }[];
    expect(via[0].via).toBe("link");
  });

  it("a fresh link retires the old one; a hidden owner's link opens nothing", async () => {
    const owner = await person("rotating");
    const old = (await friendLink(owner))!;
    const fresh = (await friendLink(owner, true))!;
    expect(fresh).not.toBe(old);
    const visitor = await person();
    expect(await readLinkCard(visitor, old)).toEqual(NOT_FOUND);
    expect((await readLinkCard(visitor, fresh)).found).toBe(true);
    await setVisible(owner, false);
    expect(await readLinkCard(visitor, fresh)).toEqual(NOT_FOUND);
    expect(await readLinkCard(visitor, "not-a-token")).toEqual(NOT_FOUND);
  });

  it("need a username", async () => {
    expect(await friendLink(await person())).toBeNull();
  });
});

describe("blocks", () => {
  it("end the friendship, the requests and the Salutes both ways, silently", async () => {
    const a = await person("blocker_a");
    const b = await person("blocked_b");
    await friendAction(a, "request", { handle: "blocked_b" });
    await friendAction(b, "accept", { handle: "blocker_a" });
    await setSalute(a, "blocked_b", true);
    await setSalute(b, "blocker_a", true);
    const c = await person("pending_c");
    await friendAction(c, "request", { handle: "blocker_a" });

    await setBlock(a, "blocked_b", true);
    await setBlock(a, "pending_c", true);

    expect((await listFriends(a)).friends).toEqual([]);
    expect((await listFriends(a)).incoming).toEqual([]);
    expect(await sql.query(`select * from salutes where (giver_id = $1 or recipient_id = $1) and revoked_at is null`, [a.id])).toEqual([]);
    expect(await readCard(b, "blocker_a")).toEqual(NOT_FOUND);
    expect(await readCard(a, "blocked_b")).toEqual(NOT_FOUND);
    expect(await setSalute(b, "blocker_a", true)).toEqual(NOT_FOUND);
    expect(await friendAction(b, "request", { handle: "blocker_a" })).toEqual({ done: false, card: NOT_FOUND });
    expect((await listBlocked(a)).map((p) => p.handle).sort()).toEqual(["blocked_b", "pending_c"]);
    expect((await listBlocked(a)).every((entry) => Object.keys(entry).join() === "handle")).toBe(true);
    const audit = (await sql.query(`select action, meta from social_audit where actor_id = $1 order by id`, [a.id])) as { action: string; meta: object }[];
    expect(audit.map((row) => row.action)).toEqual(["handle_set", "friend_request", "salute", "block", "block"]);
    expect(JSON.stringify(audit)).not.toContain("@example.com");
  });

  it("list a hidden card and a missing name alike: the name as typed, nothing more", async () => {
    const a = await person("list_keeper");
    const hidden = await person("Quiet_Harbour");
    await setVisible(hidden, false);
    await setBlock(a, "quiet_HARBOUR", true);
    await setBlock(a, "Never_Was", true);
    // Renaming later changes nothing in the list.
    await sql.query(`update handles set handle = 'renamed_now', handle_norm = 'renamednow' where user_id = $1`, [hidden.id]);
    const list = await listBlocked(a);
    expect(list.map((entry) => entry.handle).sort()).toEqual(["never_was", "quiet_harbour"]);
    expect(JSON.stringify(list)).not.toMatch(/renamed|avatar|xp/i);
    // The block still holds on the person, under their new name too.
    expect(await readCard(hidden, "list_keeper")).toEqual(NOT_FOUND);
    // And lifts by the typed name.
    await setBlock(a, "quiet_harbour", false);
    expect((await listBlocked(a)).map((entry) => entry.handle)).toEqual(["never_was"]);
  });

  it("lifting one restores visibility, not the friendship", async () => {
    const a = await person("lift_a");
    const b = await person("lift_b");
    await friendAction(a, "request", { handle: "lift_b" });
    await friendAction(b, "accept", { handle: "lift_a" });
    await setBlock(a, "lift_b", true);
    await setBlock(a, "lift_b", false);
    const card = await readCard(b, "lift_a");
    expect(card.found && card.viewer?.relation).toBe("none");
  });

  it("blocking or reporting a name that does not exist looks like any other", async () => {
    const a = await person("quiet_blocker");
    const unknown = await runSocialOp("block", { handle: "ghost_name", on: true }, { viewer: a, anonKey: "k" });
    await person("real_name");
    const known = await runSocialOp("block", { handle: "real_name", on: true }, { viewer: a, anonKey: "k" });
    expect(unknown).toEqual(known);
    await report(a, "ghost_name", "name");
    const reported = await runSocialOp("report", { handle: "real_name", reason: "impersonation" }, { viewer: a, anonKey: "k" });
    expect(reported).toEqual({ status: 200, body: { ok: true } });
    const rows = (await sql.query(`select handle_snapshot, reason from social_reports where reporter_id = $1`, [a.id])) as unknown[];
    expect(rows).toEqual([{ handle_snapshot: "real_name", reason: "impersonation" }]);
  });
});

describe("the friends board", () => {
  const now = new Date("2026-09-20T12:00:00Z");
  const xp = (userId: string, kind: string, amount: number, at: string, ref: string | null = null) =>
    sql.query(`insert into xp_events (user_id, kind, amount, ref, created_at) values ($1, $2, $3, $4, $5::timestamptz)`, [userId, kind, amount, ref, at]);
  const befriend = async (a: SocialViewer & { name: string }, b: SocialViewer & { name: string }) => {
    await friendAction(a, "request", { handle: b.name });
    await friendAction(b, "accept", { handle: a.name });
  };

  it("counts this month's XP with order XP capped at 300, plus at most 10 salute points", async () => {
    const me = await person("board_me");
    const trader = await person("board_trader");
    const steady = await person("board_steady");
    await befriend(me, trader);
    await befriend(me, steady);
    // Five orders this month: 500 XP, of which 300 count. Last month's do not.
    for (let i = 0; i < 5; i++) await xp(trader.id, "pour_in", 100, "2026-09-05T10:00:00Z", `t${i}`);
    await xp(trader.id, "pour_out", 100, "2026-08-31T23:59:59Z", "t-old");
    // Other kinds count in full.
    await xp(steady.id, "held_30_days", 150, "2026-09-10T10:00:00Z", "h1");
    await xp(steady.id, "friend_poured", 250, "2026-09-11T10:00:00Z", "f1");
    await xp(steady.id, "pour_in", 100, "2026-09-12T10:00:00Z", "s1");
    // Twelve Salutes this month for me: ten count. One revoked, one first given in August.
    const fans = [];
    for (let i = 0; i < 12; i++) fans.push(await person());
    for (const fan of fans) await setSalute(fan, "board_me", true);
    // first_at defaults to the database clock; pin it inside the board's
    // month (September, from `now`) so the count holds on any real date,
    // the first of October included.
    await sql.query(`update salutes set first_at = '2026-09-15T00:00:00Z' where giver_id = any($1::uuid[])`, [
      fans.map((fan) => fan.id),
    ]);
    const lateFan = await person();
    await setSalute(lateFan, "board_me", true);
    await sql.query(`update salutes set first_at = '2026-08-15T00:00:00Z' where giver_id = $1`, [lateFan.id]);
    await setSalute(fans[0], "board_me", false);
    await setSalute(lateFan, "board_me", false);
    await setSalute(lateFan, "board_me", true);

    const board = await friendsBoard(me, now);
    expect(board.month).toBe("2026-09");
    const byName = Object.fromEntries(board.rows.map((row) => [row.handle, row]));
    expect(byName.board_trader).toMatchObject({ orderXp: 300, otherXp: 0, salutePoints: 0, points: 300 });
    expect(byName.board_steady).toMatchObject({ orderXp: 100, referralXp: 250, otherXp: 150, salutePoints: 0, points: 500 });
    expect(byName.board_me).toMatchObject({ orderXp: 0, otherXp: 0, salutePoints: 10, points: 10, you: true });
    expect(board.rows.map((row) => row.handle)).toEqual(["board_steady", "board_trader", "board_me"]);
    expect(board.rows.map((row) => row.place)).toEqual([1, 2, 3]);
    // Never money, never returns: the rows carry points and their parts only.
    expect(Object.keys(board.rows[0]).sort()).toEqual(
      ["avatarId", "handle", "orderXp", "otherXp", "place", "points", "referralXp", "salutePoints", "xp", "you"].sort(),
    );
  });

  it("caps invite XP at 250 a month", async () => {
    const me = await person("inviter_me");
    for (let i = 0; i < 3; i++) await xp(me.id, "friend_poured", 250, "2026-09-03T10:00:00Z", `ref${i}-${me.id}`);
    await xp(me.id, "invite_accepted", 250, "2026-09-04T10:00:00Z", null);
    await xp(me.id, "email_linked", 150, "2026-09-04T10:00:00Z", null);
    const row = (await friendsBoard(me, now)).rows[0];
    expect(row).toMatchObject({ referralXp: 250, otherXp: 150, points: 400 });
  });

  it("holds only you and your visible friends; equal points share a place", async () => {
    const me = await person("solo_me");
    const friend = await person("solo_friend");
    const hiddenFriend = await person("solo_hidden");
    const stranger = await person("solo_stranger");
    await befriend(me, friend);
    await befriend(me, hiddenFriend);
    await setVisible(hiddenFriend, false);
    await xp(stranger.id, "held_30_days", 150, "2026-09-10T10:00:00Z", "x1");
    const board = await friendsBoard(me, now);
    expect(board.rows.map((row) => row.handle).sort()).toEqual(["solo_friend", "solo_me"]);
    expect(board.rows.map((row) => row.place)).toEqual([1, 1]);
    // The friend sees the same pair, and not the hidden one.
    expect((await friendsBoard(friend, now)).rows.map((row) => row.handle).sort()).toEqual(["solo_friend", "solo_me"]);
  });

  it("shows you alone before you have friends", async () => {
    const me = await person("lonely");
    expect((await friendsBoard(me, now)).rows).toMatchObject([{ handle: "lonely", you: true, place: 1, points: 0 }]);
  });
});

describe("the route table", () => {
  it("lets a signed out visitor open cards and nothing else", async () => {
    await person("public_face");
    const card = await runSocialOp("card", { handle: "public_face" }, { viewer: null, anonKey: "1.2.3.4" });
    expect(card).toEqual({ status: 200, body: { found: false, signIn: true } });
    const token = (await friendLink((await sql.query(`select user_id as id, 'x' as email from handles where handle = 'public_face'`) as SocialViewer[])[0]))!;
    expect(await runSocialOp("link-card", { token }, { viewer: null, anonKey: "1.2.3.4" })).toEqual(card);
    expect(await runSocialOp("salute", { handle: "public_face", on: true }, { viewer: null, anonKey: "1.2.3.4" })).toEqual({
      status: 401,
      body: { error: "sign in" },
    });
  });

  it("rate limits the availability check", async () => {
    const eager = await person();
    for (let i = 0; i < 20; i++) expect((await runSocialOp("check", { handle: `name_${i}` }, { viewer: eager, anonKey: "k" })).status).toBe(200);
    expect((await runSocialOp("check", { handle: "name_x" }, { viewer: eager, anonKey: "k" })).status).toBe(429);
  });
});

describe("find a friend", () => {
  it("answers missing, hidden, blocked and blocking exactly alike", async () => {
    const seeker = await person("seeker_one");
    const hidden = await person("find_hidden");
    await setVisible(hidden, false);
    await person("find_blocked");
    await setBlock(seeker, "find_blocked", true);
    const blocksMe = await person("find_blocker");
    await setBlock(blocksMe, "seeker_one", true);
    const answers = await Promise.all(
      ["nobody_by_this", "find_hidden", "find_blocked", "find_blocker", "%%%", "ab"].map((handle) =>
        runSocialOp("find", { handle }, { viewer: seeker, anonKey: "k" }),
      ),
    );
    for (const answer of answers) {
      expect(answer).toEqual({ status: 200, body: NOT_FOUND });
      expect(JSON.stringify(answer)).toBe(JSON.stringify(answers[0]));
    }
  });

  it("finds an exact name, case as typed, with the relation to act on", async () => {
    const seeker = await person("seeker_two");
    await person("tidewater_joe");
    const found = await runSocialOp("find", { handle: "Tidewater_Joe" }, { viewer: seeker, anonKey: "k" });
    expect(found.status).toBe(200);
    expect(found.body).toMatchObject({ found: true, card: { handle: "tidewater_joe" }, viewer: { relation: "none" } });
    // Exact only: no prefix match.
    expect((await runSocialOp("find", { handle: "tidewater_jo" }, { viewer: seeker, anonKey: "k" })).body).toEqual(NOT_FOUND);
  });

  it("needs a verified email, and says so the same whatever the name", async () => {
    const walletOnly = await person(undefined, { email: false });
    await person("some_name");
    const known = await runSocialOp("find", { handle: "some_name" }, { viewer: walletOnly, anonKey: "k" });
    const unknown = await runSocialOp("find", { handle: "no_such_name" }, { viewer: walletOnly, anonKey: "k" });
    expect(known).toEqual({ status: 403, body: { error: "email" } });
    expect(unknown).toEqual(known);
    expect((await runSocialOp("find", { handle: "some_name" }, { viewer: null, anonKey: "k" })).status).toBe(401);
  });

  it("allows 30 lookups an hour per account", async () => {
    const eager = await person("eager_finder");
    for (let i = 0; i < 30; i++) expect((await runSocialOp("find", { handle: `name_${i}` }, { viewer: eager, anonKey: "k" })).status).toBe(200);
    expect((await runSocialOp("find", { handle: "name_x" }, { viewer: eager, anonKey: "k" })).status).toBe(429);
    // Another account has its own hour.
    const calm = await person("calm_finder");
    expect((await runSocialOp("find", { handle: "name_x" }, { viewer: calm, anonKey: "k" })).status).toBe(200);
  });

  it("shares its hour with the /u/<name> card, which also needs a verified email", async () => {
    const guesser = await person("name_guesser");
    await person("real_target");
    for (let i = 0; i < 15; i++) expect((await runSocialOp("find", { handle: `guess_${i}` }, { viewer: guesser, anonKey: "k" })).status).toBe(200);
    for (let i = 0; i < 15; i++) expect((await runSocialOp("card", { handle: `other_${i}` }, { viewer: guesser, anonKey: "k" })).status).toBe(200);
    expect((await runSocialOp("card", { handle: "real_target" }, { viewer: guesser, anonKey: "k" })).status).toBe(429);
    expect((await runSocialOp("find", { handle: "real_target" }, { viewer: guesser, anonKey: "k" })).status).toBe(429);

    const walletOnly = await person(undefined, { email: false });
    const known = await runSocialOp("card", { handle: "real_target" }, { viewer: walletOnly, anonKey: "k" });
    expect(known).toEqual({ status: 200, body: NOT_FOUND });
    expect(await runSocialOp("card", { handle: "no_such_one" }, { viewer: walletOnly, anonKey: "k" })).toEqual(known);
  });
});
