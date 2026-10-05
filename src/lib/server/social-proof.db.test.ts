import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setSqlClient, type SqlClient } from "@/lib/server/db";
import { makeTestDb } from "@/lib/server/pglite-test-db";
import { computeMostBought, forgetMostBought, friendsHolding, friendHolds, loadMostBought, mostBoughtMaxAge } from "./social-proof";
import { markNoticeSeen, pendingNotices } from "./notices";
import { readCard } from "./social/cards";
import { mySocial, setShareHoldings } from "./social/handles";
import { runSocialOp } from "./social/ops";
import { POLICY_NOTICE_ID, SOCIAL_NOTICE_ID, publishedWeek } from "@/lib/social-proof";

/**
 * The two social counts against the real schema (PGlite): which orders
 * count as a buyer in the closed week (ownership proven, inside the week, a
 * listing, $10 or more, an account a week old with an email, no staff,
 * merges folded), and which friends' holdings may be seen (both sides
 * sharing and shown, no blocks, a recent daily value). Also the notice
 * that is said once per account.
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

const NOW = new Date("2026-10-02T12:00:00Z");
/** The first published week: Monday 5 to Monday 12 October, out from Tuesday 13 October. */
const WEEK = publishedWeek(new Date("2026-10-14T12:00:00Z"))!;
const IN_WEEK = "2026-10-08T12:00:00Z";
const OLD = "2026-08-01T00:00:00Z";

let n = 0;
async function account({ email = true, staffEmail = false, createdAt = OLD }: { email?: boolean; staffEmail?: boolean; createdAt?: string } = {}): Promise<string> {
  n += 1;
  const address = staffEmail ? `staff${n}@sodax.com` : `p${n}@example.com`;
  const rows = (await sql.query(`insert into users (privy_did, email, created_at) values ($1, $2, $3::timestamptz) returning id`, [
    `did:privy:proof${n}`,
    email ? address : null,
    createdAt,
  ])) as { id: string }[];
  return rows[0].id;
}
const accounts = (count: number) => Promise.all(Array.from({ length: count }, () => account()));

let tx = 0;
async function buy(
  userId: string | null,
  symbol: string,
  { at = IN_WEEK, direction = "buy", usd = 20, noXp }: { at?: string; direction?: string; usd?: number | null; noXp?: "unavailable" | "unproven_source" } = {},
) {
  tx += 1;
  const intent = `0xintent${tx}`;
  await sql.query(
    `insert into orders (user_id, intent_tx, direction, listing_symbol, listing_address, quantity, usd_value, placed_at, filled_at)
     values ($1, $2, $3, $4, '0x0', 1, $6, $5::timestamptz, $5::timestamptz)`,
    [userId, intent, direction, symbol, at, usd],
  );
  if (noXp) await sql.query(`insert into no_xp_intents (intent_tx, reason) values ($1, $2)`, [intent, noXp]);
}

const NO_STAFF = {};
const rows = async (env: Record<string, string> = NO_STAFF) => (await computeMostBought(WEEK, env)).rows;

describe("most bought this week, from the ledger", () => {
  beforeEach(async () => {
    await sql.query(`delete from no_xp_intents`);
    await sql.query(`delete from orders`);
    forgetMostBought();
  });

  it("counts the closed week, one per person, and nothing below the thresholds", async () => {
    const people = await accounts(10);
    for (const id of people.slice(0, 5)) await buy(id, "NVDA");
    await buy(people[0], "NVDA");
    for (const id of people.slice(5, 9)) await buy(id, "AAPL");
    expect(await rows()).toEqual([]);
    await buy(people[9], "AAPL");
    expect(await rows()).toEqual([
      { symbol: "NVDA", people: 5, plus: false },
      { symbol: "AAPL", people: 5, plus: false },
    ]);
  });

  it("leaves out buys after or before the week, sells, cash, small buys and buys with no account", async () => {
    const people = await accounts(10);
    for (const id of people.slice(0, 9)) await buy(id, "NVDA");
    // The Monday after is not in the week, nor is the Sunday before.
    await buy(people[9], "NVDA", { at: "2026-10-12T00:00:00Z" });
    await buy(people[9], "NVDA", { at: "2026-10-04T23:59:59Z" });
    await buy(people[9], "NVDA", { direction: "sell" });
    await buy(people[9], "NVDA", { usd: 9.5 });
    await buy(people[9], "NVDA", { usd: null });
    await buy(people[9], "SGOV", { usd: 500 });
    await buy(null, "NVDA");
    expect(await rows()).toEqual([]);
    // The last second of the week counts.
    await buy(people[9], "NVDA", { at: "2026-10-11T23:59:59Z" });
    expect(await rows()).toEqual([{ symbol: "NVDA", people: 10, plus: false }]);
  });

  it("does not count buys that earn no XP, whatever the reason", async () => {
    const people = await accounts(10);
    for (const id of people.slice(0, 8)) await buy(id, "TSLA");
    await buy(people[8], "TSLA", { noXp: "unavailable" });
    await buy(people[9], "TSLA", { noXp: "unproven_source" });
    expect(await rows()).toEqual([]);
    await buy(people[8], "TSLA");
    await buy(people[9], "TSLA");
    expect(await rows()).toEqual([{ symbol: "TSLA", people: 10, plus: false }]);
  });

  it("counts only accounts a week old at the close, with a verified email", async () => {
    const people = await accounts(9);
    for (const id of people) await buy(id, "QQQ");
    // Opened on 6 October: less than a week old when the week closed on the 12th.
    const young = await account({ createdAt: "2026-10-06T00:00:00Z" });
    const noEmail = await account({ email: false });
    await buy(young, "QQQ");
    await buy(noEmail, "QQQ");
    expect(await rows()).toEqual([]);
    await buy(await account(), "QQQ");
    expect(await rows()).toEqual([{ symbol: "QQQ", people: 10, plus: false }]);
  });

  it("counts two merged accounts as one person", async () => {
    const people = await accounts(9);
    const absorbed = await account();
    await sql.query(`update users set retired_into = $1, retired_at = now() where id = $2`, [people[0], absorbed]);
    for (const id of people) await buy(id, "NVDA");
    await buy(absorbed, "NVDA");
    expect(await rows()).toEqual([]);
    await buy(await account(), "NVDA");
    expect(await rows()).toEqual([{ symbol: "NVDA", people: 10, plus: false }]);
  });

  it("leaves staff out: a @sodax.com email, or an id on the staff lists", async () => {
    const people = await accounts(9);
    const byEmail = await account({ staffEmail: true });
    for (const id of [...people, byEmail]) await buy(id, "NVDA");
    expect(await rows()).toEqual([]);
    const byId = await account();
    await buy(byId, "NVDA");
    expect(await rows()).toEqual([{ symbol: "NVDA", people: 10, plus: false }]);
    expect(await rows({ STAFF_ADMIN_IDS: "", STAFF_VIEWER_IDS: byId })).toEqual([]);
  });

  it("rounds counts above ten", async () => {
    const people = await accounts(17);
    for (const id of people) await buy(id, "MSFT");
    expect(await rows()).toEqual([{ symbol: "MSFT", people: 15, plus: true }]);
  });

  it("is stored once per week, served as stored on every instance, and empty before the first week", async () => {
    await sql.query(`delete from most_bought_weeks`);
    const people = await accounts(10);
    for (const id of people) await buy(id, "QQQ");
    // Before the first week has closed and settled, nothing at all.
    expect(await loadMostBought(NOW, NO_STAFF)).toEqual({ rows: [], days: 7 });
    expect(await loadMostBought(new Date("2026-10-12T23:59:00Z"), NO_STAFF)).toEqual({ rows: [], days: 7 });
    const out = new Date("2026-10-13T00:00:01Z");
    const first = await loadMostBought(out, NO_STAFF);
    expect(first).toEqual({ rows: [{ symbol: "QQQ", people: 10, plus: false }], days: 7, week: "2026-10-05" });
    // Recorded late, after publishing: the stored week does not move, on this instance or a fresh one.
    await sql.query(`delete from orders`);
    expect(await loadMostBought(new Date("2026-10-15T00:00:00Z"), NO_STAFF)).toEqual(first);
    forgetMostBought();
    expect(await loadMostBought(new Date("2026-10-19T23:00:00Z"), NO_STAFF)).toEqual(first);
    // Another instance's earlier row wins over a fresh computation.
    forgetMostBought();
    await sql.query(`update most_bought_weeks set answer = $1::jsonb where week_start = '2026-10-05'`, [
      JSON.stringify({ rows: [{ symbol: "AAPL", people: 12, plus: false }], days: 7, week: "2026-10-05" }),
    ]);
    expect((await loadMostBought(out, NO_STAFF)).rows).toEqual([{ symbol: "AAPL", people: 12, plus: false }]);
    // The next week publishes on the Tuesday after it, from what is recorded then.
    forgetMostBought();
    expect(await loadMostBought(new Date("2026-10-20T00:00:01Z"), NO_STAFF)).toEqual({ rows: [], days: 7, week: "2026-10-12" });
    const stored = (await sql.query(`select to_char(week_start, 'YYYY-MM-DD') as w from most_bought_weeks order by week_start`)) as { w: string }[];
    expect(stored.map((row) => row.w)).toEqual(["2026-10-05", "2026-10-12"]);
  });

  it("lets the CDN keep the answer until the next week is out, a day at most", () => {
    expect(mostBoughtMaxAge(new Date("2026-10-19T23:00:00Z"))).toBe(3600);
    expect(mostBoughtMaxAge(new Date("2026-10-15T00:00:00Z"))).toBe(86_400);
    expect(mostBoughtMaxAge(new Date("2026-10-19T23:59:59.5Z"))).toBe(60);
  });
});

async function named(handle: string, { visible = true, email = true, share = true }: { visible?: boolean; email?: boolean; share?: boolean } = {}): Promise<string> {
  const id = await account({ email });
  await sql.query(`insert into handles (user_id, handle, handle_norm) values ($1, $2, $2)`, [id, handle]);
  await sql.query(`insert into profiles (user_id, visible, share_holdings) values ($1, $2, $3)`, [id, visible, share]);
  return id;
}

async function befriend(a: string, b: string) {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  await sql.query(`insert into friends (a_id, b_id) values ($1, $2)`, [lo, hi]);
}

async function holds(userId: string, holdings: { symbol: string; quantity: number; price: number }[], day = "2026-10-01") {
  await sql.query(
    `insert into portfolio_days (user_id, day, value_usd, holdings, source, as_of) values ($1, $2::date, 1, $3::jsonb, 'snapshot', now())`,
    [userId, day, JSON.stringify(holdings.map((holding) => ({ ...holding, source: "mark" })))],
  );
}

const as = (id: string) => ({ id, email: "x@example.com" });

describe("what friends hold", () => {
  it("is off by default for everyone, on a new profile row", async () => {
    const id = await account();
    await sql.query(`insert into handles (user_id, handle, handle_norm) values ($1, 'fresh_one', 'fresh_one')`, [id]);
    await sql.query(`insert into profiles (user_id) values ($1)`, [id]);
    expect((await mySocial(as(id))).shareHoldings).toBe(false);
    expect((await setShareHoldings(as(id), true))?.shareHoldings).toBe(true);
    expect((await setShareHoldings(as(id), false))?.shareHoldings).toBe(false);
  });

  it("counts friends who share, names one or two, and never an amount", async () => {
    const me = await named("viewer_one");
    const mara = await named("mara");
    const anchor = await named("anchor");
    const quay = await named("quay");
    for (const friend of [mara, anchor, quay]) await befriend(me, friend);
    await holds(mara, [{ symbol: "NVDA", quantity: 2, price: 180 }, { symbol: "AAPL", quantity: 1, price: 230 }]);
    await holds(anchor, [{ symbol: "NVDA", quantity: 1, price: 180 }, { symbol: "SGOV", quantity: 5, price: 100 }]);
    await holds(quay, [{ symbol: "NVDA", quantity: 0.5, price: 180 }]);
    await sql.query(`update users set avatar_id = 'ring', xp = 1500 where id = $1`, [mara]);
    const answer = await friendsHolding(as(me), NOW);
    expect(answer.holding).toEqual([
      {
        symbol: "NVDA",
        count: 3,
        names: [],
        faces: [
          { handle: "anchor", avatarId: null, level: 1 },
          { handle: "mara", avatarId: "ring", level: 6 },
          { handle: "quay", avatarId: null, level: 1 },
        ],
      },
      { symbol: "AAPL", count: 1, names: ["mara"], faces: [{ handle: "mara", avatarId: "ring", level: 6 }] },
    ]);
    expect(JSON.stringify(answer)).not.toMatch(/quantity|price|xp|1500|180|230/);
  });

  it("leaves out friends who do not share, hidden cards, no email, blocks either way, strangers and days over three old", async () => {
    const me = await named("viewer_two");
    const notSharing = await named("not_sharing", { share: false });
    const hidden = await named("hidden_one", { visible: false });
    const noEmail = await named("no_email", { email: false });
    const blockedByMe = await named("blocked_by_me");
    const blocksMe = await named("blocks_me");
    const stale = await named("stale_one");
    const stranger = await named("stranger");
    const shown = await named("shown_one");
    for (const friend of [notSharing, hidden, noEmail, blockedByMe, blocksMe, stale, shown]) await befriend(me, friend);
    await sql.query(`insert into blocks (blocker_id, blocked_id, handle_snapshot, handle_norm) values ($1, $2, 'blocked_by_me', 'blocked_by_me')`, [me, blockedByMe]);
    await sql.query(`insert into blocks (blocker_id, blocked_id, handle_snapshot, handle_norm) values ($1, $2, 'viewer_two', 'viewer_two')`, [blocksMe, me]);
    for (const id of [notSharing, hidden, noEmail, blockedByMe, blocksMe, stranger, shown]) await holds(id, [{ symbol: "TSLA", quantity: 1, price: 400 }]);
    await holds(stale, [{ symbol: "TSLA", quantity: 1, price: 400 }], "2026-09-28");
    expect((await friendsHolding(as(me), NOW)).holding).toEqual([
      { symbol: "TSLA", count: 1, names: ["shown_one"], faces: [{ handle: "shown_one", avatarId: null, level: 1 }] },
    ]);
  });

  it("shows nothing to a viewer who does not share, or whose own card is hidden", async () => {
    const quiet = await named("quiet_viewer", { share: false });
    const hiddenViewer = await named("hidden_viewer", { visible: false });
    const friend = await named("open_friend");
    await befriend(quiet, friend);
    await befriend(hiddenViewer, friend);
    await holds(friend, [{ symbol: "GOOGL", quantity: 1, price: 150 }]);
    expect((await friendsHolding(as(quiet), NOW)).holding).toEqual([]);
    expect((await friendsHolding(as(hiddenViewer), NOW)).holding).toEqual([]);
    expect(await friendHolds(as(quiet), friend, NOW)).toBeNull();
    // Turning sharing on opens both directions at once.
    await setShareHoldings(as(quiet), true);
    expect((await friendsHolding(as(quiet), NOW)).holding).toEqual([
      { symbol: "GOOGL", count: 1, names: ["open_friend"], faces: [{ handle: "open_friend", avatarId: null, level: 1 }] },
    ]);
  });

  it("reads only the friend's latest day: a sold holding stops counting", async () => {
    const me = await named("viewer_three");
    const sold = await named("sold_it");
    await befriend(me, sold);
    await holds(sold, [{ symbol: "META", quantity: 1, price: 700 }], "2026-09-30");
    await holds(sold, [], "2026-10-01");
    expect((await friendsHolding(as(me), NOW)).holding).toEqual([]);
  });

  it("puts the listings on a friend's card only when both share, never on a stranger's", async () => {
    const me = await named("cardviewer");
    const friend = await named("cardfriend");
    const stranger = await named("cardstranger");
    await befriend(me, friend);
    await holds(friend, [{ symbol: "TSLA", quantity: 1, price: 400 }, { symbol: "NVDA", quantity: 1, price: 180 }]);
    await holds(stranger, [{ symbol: "NVDA", quantity: 1, price: 180 }]);
    const card = await readCard(as(me), "cardfriend", NOW);
    expect(card.found && card.holds).toEqual(["NVDA", "TSLA"]);
    const strangerCard = await readCard(as(me), "cardstranger", NOW);
    expect(strangerCard.found && "holds" in strangerCard).toBe(false);
    // The viewer shares: their card of anyone says so, for the note beside Add friend and Accept.
    expect(strangerCard.found && strangerCard.viewer.sharesHoldings).toBe(true);
    await setShareHoldings(as(friend), false);
    const off = await readCard(as(me), "cardfriend", NOW);
    expect(off.found && "holds" in off).toBe(false);
    await setShareHoldings(as(me), false);
    const quiet = await readCard(as(me), "cardstranger", NOW);
    expect(quiet.found && "sharesHoldings" in quiet.viewer).toBe(false);
  });

  it("is answered through the social route only to a signed in viewer", async () => {
    const me = await named("viewer_four");
    const friend = await named("friend_four");
    await befriend(me, friend);
    await holds(friend, [{ symbol: "AMZN", quantity: 1, price: 200 }], new Date().toISOString().slice(0, 10));
    const signedOut = await runSocialOp("holding", {}, { viewer: null, anonKey: "k" });
    expect(signedOut.status).toBe(401);
    const signedIn = await runSocialOp("holding", {}, { viewer: as(me), anonKey: "k" });
    expect(signedIn.status).toBe(200);
    expect((signedIn.body as { holding: unknown[] }).holding).toEqual([
      { symbol: "AMZN", count: 1, names: ["friend_four"], faces: [{ handle: "friend_four", avatarId: null, level: 1 }] },
    ]);
    const set = await runSocialOp("share-holdings", { on: false }, { viewer: as(me), anonKey: "k" });
    expect((set.body as { shareHoldings: boolean }).shareHoldings).toBe(false);
  });
});

describe("the notices said once per account", () => {
  it("are due until closed, each on its own, and closing one twice changes nothing", async () => {
    const id = await account();
    expect(await pendingNotices(id)).toEqual([SOCIAL_NOTICE_ID, POLICY_NOTICE_ID]);
    expect(await markNoticeSeen(id, SOCIAL_NOTICE_ID)).toBe(true);
    expect(await markNoticeSeen(id, SOCIAL_NOTICE_ID)).toBe(true);
    expect(await pendingNotices(id)).toEqual([POLICY_NOTICE_ID]);
    expect(await markNoticeSeen(id, POLICY_NOTICE_ID)).toBe(true);
    expect(await pendingNotices(id)).toEqual([]);
    expect(await markNoticeSeen(id, "anything-else")).toBe(false);
    const viaRoute = await runSocialOp("notices", {}, { viewer: { id: await account(), email: null }, anonKey: "k" });
    expect(viaRoute.body).toEqual({ pending: [SOCIAL_NOTICE_ID, POLICY_NOTICE_ID] });
  });
});
