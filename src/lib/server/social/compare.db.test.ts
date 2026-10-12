import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setSqlClient, type SqlClient } from "@/lib/server/db";
import { makeTestDb } from "@/lib/server/pglite-test-db";
import { compareFriends, friendWeek } from "./compare";
import { mySocial, setShareWeek } from "./handles";
import { runSocialOp } from "./ops";
import { SOCIAL_LIMITS } from "./limits";
import { foldHandle } from "@/lib/handle";

/**
 * Compare with friends against the real schema (PGlite): who may be drawn
 * beside the viewer (friends, both switches on, both cards shown, no block
 * either way, a recent daily value), that it works both ways only while
 * both are on, that a friend's line carries percentages and days and
 * nothing else, and that it is only ever as long as the viewer's window.
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

/** Friday 9 October 2026, in the afternoon in New York. */
const NOW = new Date("2026-10-09T18:00:00Z");

let n = 0;
async function named(
  handle: string,
  { visible = true, email = true, share = true }: { visible?: boolean; email?: boolean; share?: boolean } = {},
): Promise<string> {
  n += 1;
  const rows = (await sql.query(`insert into users (privy_did, email) values ($1, $2) returning id`, [
    `did:privy:compare${n}`,
    email ? `c${n}@example.com` : null,
  ])) as { id: string }[];
  const id = rows[0].id;
  await sql.query(`insert into handles (user_id, handle, handle_norm) values ($1, $2, $3)`, [id, handle, foldHandle(handle)]);
  await sql.query(`insert into profiles (user_id, visible, share_week) values ($1, $2, $3)`, [id, visible, share]);
  return id;
}

async function befriend(a: string, b: string) {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  await sql.query(`insert into friends (a_id, b_id) values ($1, $2)`, [lo, hi]);
}

let tx = 0;
/** One holding of NVDA, bought on the first day and held, at these closes: only prices move it. */
async function record(userId: string, prices: Record<string, number>, quantity = 2) {
  const [first, price] = Object.entries(prices)[0];
  tx += 1;
  await sql.query(
    `insert into orders (user_id, intent_tx, direction, listing_symbol, listing_address, quantity, usd_value, placed_at, filled_at)
     values ($1, $2, 'buy', 'NVDA', '0x0', $3, $4, $5::timestamptz, $5::timestamptz)`,
    [userId, `0xcompare${tx}`, quantity, quantity * price, `${first}T15:00:00Z`],
  );
  for (const [day, price] of Object.entries(prices)) {
    await sql.query(
      `insert into portfolio_days (user_id, day, value_usd, holdings, source, as_of)
       values ($1, $2::date, $3, $4::jsonb, 'snapshot', $5::timestamptz)`,
      [userId, day, quantity * price, JSON.stringify([{ symbol: "NVDA", quantity, price, source: "mark" }]), `${day}T21:30:00Z`],
    );
  }
}

const WEEK = { "2026-10-02": 100, "2026-10-05": 102, "2026-10-06": 99, "2026-10-07": 101, "2026-10-08": 104.5 };
const LONG = { "2026-09-28": 90, "2026-09-29": 91, "2026-09-30": 95, "2026-10-01": 97, ...WEEK };

const as = (id: string) => ({ id, email: "x@example.com" });

describe("compare with friends", () => {
  it("is off by default, and the switch is the account's own", async () => {
    const id = await named("fresh_compare", { share: false });
    await sql.query(`delete from profiles where user_id = $1`, [id]);
    await sql.query(`insert into profiles (user_id) values ($1)`, [id]);
    expect((await mySocial(as(id))).shareWeek).toBe(false);
    expect((await setShareWeek(as(id), true))?.shareWeek).toBe(true);
    expect((await setShareWeek(as(id), false))?.shareWeek).toBe(false);
  });

  it("offers only friends who compare, shown, unblocked and with a recent day", async () => {
    const me = await named("cmp_viewer");
    const shown = await named("cmp_shown");
    const notSharing = await named("cmp_not_sharing", { share: false });
    const hidden = await named("cmp_hidden", { visible: false });
    const noEmail = await named("cmp_no_email", { email: false });
    const blockedByMe = await named("cmp_blocked_by_me");
    const blocksMe = await named("cmp_blocks_me");
    const stale = await named("cmp_stale");
    const retired = await named("cmp_retired");
    const stranger = await named("cmp_stranger");
    for (const friend of [shown, notSharing, hidden, noEmail, blockedByMe, blocksMe, stale, retired]) await befriend(me, friend);
    await sql.query(`insert into blocks (blocker_id, blocked_id, handle_snapshot, handle_norm) values ($1, $2, 'cmp_blocked_by_me', 'cmp_blocked_by_me')`, [me, blockedByMe]);
    await sql.query(`insert into blocks (blocker_id, blocked_id, handle_snapshot, handle_norm) values ($1, $2, 'cmp_viewer', 'cmp_viewer')`, [blocksMe, me]);
    await sql.query(`update users set retired_into = $1 where id = $2`, [shown, retired]);
    for (const id of [me, shown, notSharing, hidden, noEmail, blockedByMe, blocksMe, retired, stranger]) await record(id, WEEK);
    await record(stale, { "2026-10-01": 100, "2026-10-02": 101 });
    await sql.query(`update users set avatar_id = 'ring', xp = 1500 where id = $1`, [shown]);

    expect(await compareFriends(as(me), NOW)).toEqual({ friends: [{ handle: "cmp_shown", avatarId: "ring", level: 6 }] });

    // The same checks guard the line itself, with one answer for every refusal.
    const ask = (handle: string) => friendWeek(as(me), { handle, range: "1w", from: "2026-10-02" }, NOW);
    expect((await ask("cmp_shown")).week).not.toBeNull();
    for (const handle of [
      "cmp_not_sharing",
      "cmp_hidden",
      "cmp_no_email",
      "cmp_blocked_by_me",
      "cmp_blocks_me",
      "cmp_stale",
      "cmp_retired",
      "cmp_stranger",
      "nobody_by_this_name",
      "cmp_viewer",
    ]) {
      expect(await ask(handle), handle).toEqual({ week: null });
    }
  });

  it("answers nothing to a viewer without a recent daily value of their own", async () => {
    const empty = await named("cmp_no_days");
    const stale = await named("cmp_viewer_stale");
    const friend = await named("cmp_has_days");
    await befriend(empty, friend);
    await befriend(stale, friend);
    await record(friend, WEEK);
    await record(stale, { "2026-10-01": 100, "2026-10-02": 101 });
    for (const viewer of [empty, stale]) {
      expect(await compareFriends(as(viewer), NOW)).toEqual({ friends: [] });
      expect(await friendWeek(as(viewer), { handle: "cmp_has_days", range: "1w", from: "2026-10-02" }, NOW)).toEqual({ week: null });
    }
    // A recent day of their own opens it.
    await record(stale, { "2026-10-08": 102 });
    expect((await compareFriends(as(stale), NOW)).friends.map((person) => person.handle)).toEqual(["cmp_has_days"]);
  });

  it("answers nothing on a friend request still pending, either way", async () => {
    const asker = await named("cmp_asker");
    const asked = await named("cmp_asked");
    await record(asker, WEEK);
    await record(asked, WEEK);
    await sql.query(`insert into friend_requests (from_id, to_id) values ($1, $2)`, [asker, asked]);
    expect(await compareFriends(as(asker), NOW)).toEqual({ friends: [] });
    expect(await compareFriends(as(asked), NOW)).toEqual({ friends: [] });
    expect(await friendWeek(as(asker), { handle: "cmp_asked", range: "1w", from: "2026-10-02" }, NOW)).toEqual({ week: null });
    expect(await friendWeek(as(asked), { handle: "cmp_asker", range: "1w", from: "2026-10-02" }, NOW)).toEqual({ week: null });
  });

  it("works both ways only while both are on", async () => {
    const a = await named("cmp_a");
    const b = await named("cmp_b");
    await befriend(a, b);
    await record(a, WEEK);
    await record(b, WEEK);
    const aSeesB = async () => (await friendWeek(as(a), { handle: "cmp_b", range: "1w", from: "2026-10-02" }, NOW)).week;
    const bSeesA = async () => (await friendWeek(as(b), { handle: "cmp_a", range: "1w", from: "2026-10-02" }, NOW)).week;
    expect(await aSeesB()).not.toBeNull();
    expect(await bSeesA()).not.toBeNull();

    // A turns it off: A no longer sees B, and B no longer sees A.
    await setShareWeek(as(a), false);
    expect(await aSeesB()).toBeNull();
    expect(await bSeesA()).toBeNull();
    expect((await compareFriends(as(a), NOW)).friends).toEqual([]);
    expect((await compareFriends(as(b), NOW)).friends).toEqual([]);

    // On again, and B hides their profile: neither sees the other.
    await setShareWeek(as(a), true);
    await sql.query(`update profiles set visible = false where user_id = $1`, [b]);
    expect(await aSeesB()).toBeNull();
    expect(await bSeesA()).toBeNull();
  });

  it("answers percentages and days only, never an amount, a holding or a value", async () => {
    const me = await named("cmp_private_me");
    const friend = await named("cmp_private_friend");
    await befriend(me, friend);
    await record(me, WEEK);
    await record(friend, WEEK, 37);
    // The route reads the wall clock, so pin it to NOW (only Date, so PGlite's timers run as usual).
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const result = await runSocialOp("compare-week", { handle: "cmp_private_friend", range: "1w", from: "2026-10-02" }, { viewer: as(me), anonKey: "k" }).finally(
      () => vi.useRealTimers(),
    );
    expect(result.status).toBe(200);
    const body = result.body as { week: { from: string; days: { day: string; pct: number }[] } };
    expect(Object.keys(body)).toEqual(["week"]);
    expect(Object.keys(body.week).sort()).toEqual(["days", "from"]);
    expect(body.week.days).toEqual([
      { day: "2026-10-02", pct: 0 },
      { day: "2026-10-05", pct: 2 },
      { day: "2026-10-06", pct: -1 },
      { day: "2026-10-07", pct: 1 },
      { day: "2026-10-08", pct: 4.5 },
    ]);
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/value|usd|holding|quantity|price|NVDA|37|3700|cmp_private_friend/);
  });

  it("is only as long as the viewer's own window: 1W, or since first buy from the later start", async () => {
    const me = await named("cmp_window_me");
    const late = await named("cmp_window_late");
    const early = await named("cmp_window_early");
    for (const friend of [late, early]) await befriend(me, friend);
    await record(me, LONG);
    await record(late, WEEK);
    await record(early, { "2026-09-01": 80, ...LONG });

    // Since first buy: the friend who started later sets the start, and both lines count from it.
    const fromLate = (await friendWeek(as(me), { handle: "cmp_window_late", range: "since", from: "2026-09-28" }, NOW)).week!;
    expect(fromLate.from).toBe("2026-10-02");
    expect(fromLate.days[0]).toEqual({ day: "2026-10-02", pct: 0 });
    // The friend who started earlier is cut to the viewer's start, rebased to 0% there.
    const fromEarly = (await friendWeek(as(me), { handle: "cmp_window_early", range: "since", from: "2026-09-28" }, NOW)).week!;
    expect(fromEarly.from).toBe("2026-09-28");
    expect(fromEarly.days[0].pct).toBe(0);
    expect(fromEarly.days.some((point) => point.day < "2026-09-28")).toBe(false);
    // Never earlier than the viewer's own first day, never a 1W window longer than ten days.
    expect((await friendWeek(as(me), { handle: "cmp_window_early", range: "since", from: "2026-09-01" }, NOW)).week).toBeNull();
    expect((await friendWeek(as(me), { handle: "cmp_window_early", range: "1w", from: "2026-09-28" }, NOW)).week).toBeNull();
    expect((await friendWeek(as(me), { handle: "cmp_window_early", range: "1m", from: "2026-10-02" }, NOW)).week).toBeNull();
    // 1W from the card's first day.
    const week = (await friendWeek(as(me), { handle: "cmp_window_early", range: "1w", from: "2026-10-02" }, NOW)).week!;
    expect(week.from).toBe("2026-10-02");
    expect(week.days.map((point) => point.day)).toEqual(Object.keys(WEEK));
  });

  it("draws 14D, 30D and 90D by the same rule, each within its own reach, with every check unchanged", async () => {
    const me = await named("cmp_ranges_me");
    const friend = await named("cmp_ranges_friend");
    const hidden = await named("cmp_ranges_hidden", { visible: false });
    await befriend(me, friend);
    await befriend(me, hidden);
    const HISTORY = { "2026-07-01": 70, "2026-07-13": 72, "2026-08-03": 75, "2026-09-01": 80, "2026-09-21": 85, ...LONG };
    await record(me, HISTORY);
    await record(friend, HISTORY);
    await record(hidden, HISTORY);
    const ask = (range: string, from: string, handle = "cmp_ranges_friend") =>
      friendWeek(as(me), { handle, range, from }, NOW).then((body) => body.week);

    // Each range from the card's first day, the friend's first close on or after it at 0%.
    const cases = [
      ["14d", "2026-09-25", "2026-09-28", "2026-09-19", "2026-09-18"],
      ["30d", "2026-09-09", "2026-09-21", "2026-08-30", "2026-08-29"],
      ["90d", "2026-07-11", "2026-07-13", "2026-07-01", "2026-06-30"],
    ] as const;
    for (const [range, from, starts, earliest, tooEarly] of cases) {
      const week = (await ask(range, from))!;
      expect(week.from).toBe(starts);
      expect(week.days[0]).toEqual({ day: starts, pct: 0 });
      expect(week.days.at(-1)!.day).toBe("2026-10-08");
      for (const point of week.days) expect(Object.keys(point).sort()).toEqual(["day", "pct"]);
      // Within its own reach and no further back.
      expect(await ask(range, earliest)).not.toBeNull();
      expect(await ask(range, tooEarly)).toBeNull();
      // The same empty answer for a friend whose card is hidden.
      expect(await ask(range, from, "cmp_ranges_hidden")).toBeNull();
    }
    expect(JSON.stringify(await ask("90d", "2026-07-11"))).not.toMatch(/value|usd|holding|quantity|price|NVDA/);
  });

  it("gives a viewer whose own record is short the same empty answer for 14D, 30D and 90D", async () => {
    const me = await named("cmp_short_me");
    const friend = await named("cmp_short_friend");
    await befriend(me, friend);
    // The viewer's record starts on Sep 28; the friend's in July.
    await record(me, LONG);
    await record(friend, { "2026-07-01": 70, "2026-08-03": 75, "2026-09-01": 80, ...LONG });
    const ask = (range: string, from: string) =>
      friendWeek(as(me), { handle: "cmp_short_friend", range, from }, NOW).then((body) => body);
    expect(await ask("90d", "2026-07-11")).toEqual({ week: null });
    expect(await ask("30d", "2026-09-09")).toEqual({ week: null });
    // Eleven days back is enough for neither 14D nor more.
    expect(await ask("14d", "2026-09-25")).toEqual({ week: null });
    // 1W and since first buy still answer, as the card offers them.
    expect((await ask("1w", "2026-10-02")).week).not.toBeNull();
    expect((await ask("since", "2026-09-28")).week).not.toBeNull();
  });

  it("is answered only to a signed in viewer, and rate limited", async () => {
    const me = await named("cmp_limit_me");
    expect((await runSocialOp("compare-friends", {}, { viewer: null, anonKey: "k" })).status).toBe(401);
    expect((await runSocialOp("compare-week", {}, { viewer: null, anonKey: "k" })).status).toBe(401);
    for (let call = 0; call < SOCIAL_LIMITS.compare; call += 1) {
      expect((await runSocialOp("compare-friends", {}, { viewer: as(me), anonKey: "k" })).status).toBe(200);
    }
    expect((await runSocialOp("compare-week", { handle: "x", range: "1w", from: "2026-10-02" }, { viewer: as(me), anonKey: "k" })).status).toBe(429);
  });
});
