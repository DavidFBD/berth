import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setSqlClient, type SqlClient } from "@/lib/server/db";
import { makeTestDb } from "@/lib/server/pglite-test-db";
import { computeMostHeld, forgetMostHeld, loadMostHeld, loadMostHeldWeek, mostHeldMaxAge } from "./most-held";
import { MOST_HELD_FIRST_WEEK } from "@/lib/most-held";
import { publishedWeek } from "@/lib/social-proof";

/**
 * Most held against the real schema (PGlite): which daily records stand
 * for what an account held at the week's close (its last one inside the
 * week, nothing from before or after), who may be counted, and that a week
 * is stored once and never moves, except a week with no record at all,
 * which waits. Records are written only on trading days, as the evening
 * cron writes them: Friday, Thursday when Friday is a holiday, never a
 * weekend.
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

/** The first published week: Monday 19 to Monday 26 October, out from Tuesday 27 October. */
const WEEK = publishedWeek(new Date("2026-10-28T12:00:00Z"), MOST_HELD_FIRST_WEEK)!;
const OLD = "2026-08-01T00:00:00Z";
const FRIDAY = "2026-10-23";
const THURSDAY = "2026-10-22";

let n = 0;
async function account({ email = true, createdAt = OLD }: { email?: boolean; createdAt?: string } = {}): Promise<string> {
  n += 1;
  const rows = (await sql.query(`insert into users (privy_did, email, created_at) values ($1, $2, $3::timestamptz) returning id`, [
    `did:privy:held${n}`,
    email ? `h${n}@example.com` : null,
    createdAt,
  ])) as { id: string }[];
  return rows[0].id;
}
const accounts = (count: number) => Promise.all(Array.from({ length: count }, () => account()));

/** One daily record: `symbols` each held at $100, or the exact holdings given. */
async function day(userId: string, on: string, holdings: string[] | { symbol: string; quantity: number; price: number | null }[]) {
  const rows = holdings.map((item) => (typeof item === "string" ? { symbol: item, quantity: 1, price: 100, source: "mark" } : { ...item, source: "mark" }));
  await sql.query(
    `insert into portfolio_days (user_id, day, value_usd, holdings, source, as_of)
     values ($1, $2::date, 100, $3::jsonb, 'snapshot', $2::date + interval '22 hours')
     on conflict (user_id, day) do update set holdings = excluded.holdings`,
    [userId, on, JSON.stringify(rows)],
  );
}

const NO_STAFF = {};
const rows = async () => (await computeMostHeld(WEEK, NO_STAFF)).rows;

describe("most held at the week's close, from the daily records", () => {
  beforeEach(async () => {
    await sql.query(`delete from portfolio_days`);
    await sql.query(`delete from most_held_weeks`);
    forgetMostHeld();
  });

  it("counts each account's last record of the week: Friday's, or an earlier day's when Friday missed it", async () => {
    const people = await accounts(60);
    for (const id of people) await day(id, FRIDAY, ["NVDA"]);
    const tesla = people.slice(0, 20);
    // Ten had no Friday record (the evening was cut short): their Thursday stands, and Monday's for one of them.
    for (const id of tesla.slice(0, 9)) {
      await sql.query(`delete from portfolio_days where user_id = $1 and day = $2::date`, [id, FRIDAY]);
      await day(id, THURSDAY, ["NVDA", "TSLA"]);
    }
    await sql.query(`delete from portfolio_days where user_id = $1 and day = $2::date`, [tesla[9], FRIDAY]);
    await day(tesla[9], "2026-10-19", ["NVDA", "TSLA"]);
    for (const id of tesla.slice(10)) await day(id, FRIDAY, ["NVDA", "TSLA"]);
    expect(await rows()).toEqual([
      { symbol: "NVDA", oneIn: 2 },
      { symbol: "TSLA", oneIn: 3 },
    ]);

    // Sold by Friday: Thursday's record holding it no longer speaks for the close.
    await day(tesla[10], THURSDAY, ["NVDA", "TSLA"]);
    await day(tesla[10], FRIDAY, ["NVDA"]);
    expect(await rows()).toEqual([{ symbol: "NVDA", oneIn: 2 }]);
  });

  it("ignores the Friday before the week and the Monday after", async () => {
    const people = await accounts(60);
    for (const id of people) await day(id, FRIDAY, ["NVDA"]);
    const outside = await accounts(20);
    for (const id of outside) await day(id, "2026-10-16", ["AAPL"]);
    for (const id of outside) await day(id, "2026-10-26", ["AAPL"]);
    expect(await rows()).toEqual([{ symbol: "NVDA", oneIn: 2 }]);
  });

  it("reads Thursday in a week whose Friday is a market holiday (Christmas 2026)", async () => {
    const christmas = publishedWeek(new Date("2026-12-29T12:00:00Z"), MOST_HELD_FIRST_WEEK)!;
    expect(christmas.label).toBe("2026-12-21");
    const people = await accounts(60);
    // No record on Friday 25 December: the market is closed and the cron writes none.
    for (const id of people) await day(id, "2026-12-24", ["NVDA"]);
    for (const id of people.slice(0, 20)) await day(id, "2026-12-24", ["NVDA", "QQQ"]);
    expect((await computeMostHeld(christmas, NO_STAFF)).rows).toEqual([
      { symbol: "NVDA", oneIn: 2 },
      { symbol: "QQQ", oneIn: 3 },
    ]);
  });

  it("leaves out young accounts and accounts without an email, and shows nothing under 50", async () => {
    const people = await accounts(48);
    const young = await account({ createdAt: "2026-10-21T00:00:00Z" });
    const noEmail = await account({ email: false });
    for (const id of [...people, young, noEmail]) await day(id, FRIDAY, ["NVDA"]);
    expect(await rows()).toEqual([]);
    const two = await accounts(2);
    for (const id of two) await day(id, FRIDAY, ["NVDA"]);
    expect(await rows()).toEqual([{ symbol: "NVDA", oneIn: 2 }]);
  });

  it("folds a merge into one person, and leaves out staff by email and by id", async () => {
    const people = await accounts(50);
    for (const id of people) await day(id, FRIDAY, ["NVDA"]);
    const retired = await account();
    await sql.query(`update users set retired_into = $1 where id = $2`, [people[0], retired]);
    await day(retired, FRIDAY, ["AAPL"]);
    const staffRows = (await sql.query(
      `insert into users (privy_did, email, created_at) values ('did:privy:heldstaff', 'crew@sodax.com', $1::timestamptz) returning id`,
      [OLD],
    )) as { id: string }[];
    await day(staffRows[0].id, FRIDAY, ["NVDA"]);
    // Still 50 people: the retired account is people[0], staff are not counted.
    const answer = await computeMostHeld(WEEK, NO_STAFF);
    expect(answer.rows).toEqual([{ symbol: "NVDA", oneIn: 2 }]);
    const withEnvStaff = await computeMostHeld(WEEK, { STAFF_VIEWER_IDS: people[1] });
    expect(withEnvStaff.rows).toEqual([]);
  });

  it("does not count a holding under $10 or one without a price", async () => {
    const people = await accounts(60);
    for (const [i, id] of people.entries()) {
      await day(id, FRIDAY, [
        { symbol: "NVDA", quantity: 1, price: 100 },
        ...(i < 30 ? [{ symbol: "TSLA", quantity: 0.05, price: 100 }] : []),
        ...(i >= 30 ? [{ symbol: "AAPL", quantity: 3, price: null }] : []),
      ]);
    }
    expect(await rows()).toEqual([{ symbol: "NVDA", oneIn: 2 }]);
  });

  it("is published once on its Tuesday, stored, and never moved by a late record", async () => {
    const people = await accounts(60);
    for (const id of people) await day(id, FRIDAY, ["NVDA"]);
    expect(await loadMostHeld(new Date("2026-10-26T23:59:00Z"), NO_STAFF)).toEqual({ rows: [] });
    const first = await loadMostHeld(new Date("2026-10-27T00:00:01Z"), NO_STAFF);
    expect(first).toEqual({ rows: [{ symbol: "NVDA", oneIn: 2 }], week: "2026-10-19" });
    for (const id of people.slice(0, 30)) await day(id, FRIDAY, ["NVDA", "AAPL"]);
    forgetMostHeld();
    expect(await loadMostHeld(new Date("2026-10-30T00:00:00Z"), NO_STAFF)).toEqual(first);
    const stored = (await sql.query(`select answer from most_held_weeks where week_start = '2026-10-19'`)) as { answer: unknown }[];
    expect(stored).toHaveLength(1);
  });

  it("stores a quiet week that has records, as published", async () => {
    const few = await accounts(10);
    for (const id of few) await day(id, FRIDAY, ["NVDA"]);
    expect(await loadMostHeldWeek(new Date("2026-10-27T00:00:01Z"), NO_STAFF)).toEqual({ answer: { rows: [], week: "2026-10-19" }, final: true });
    const stored = (await sql.query(`select answer from most_held_weeks where week_start = '2026-10-19'`)) as { answer: unknown }[];
    expect(stored).toHaveLength(1);
  });

  it("never stores a week with no record at all, and counts it once the records arrive", async () => {
    const at = new Date("2026-10-27T00:00:01Z");
    expect(await loadMostHeldWeek(at, NO_STAFF)).toEqual({ answer: { rows: [], week: "2026-10-19" }, final: false });
    expect((await sql.query(`select 1 from most_held_weeks`)) as unknown[]).toHaveLength(0);
    // The evening job is rerun for Friday: the next request counts the week and stores it.
    const people = await accounts(60);
    for (const id of people) await day(id, FRIDAY, ["NVDA"]);
    const later = await loadMostHeldWeek(new Date("2026-10-27T06:00:00Z"), NO_STAFF);
    expect(later).toEqual({ answer: { rows: [{ symbol: "NVDA", oneIn: 2 }], week: "2026-10-19" }, final: true });
    expect((await sql.query(`select 1 from most_held_weeks`)) as unknown[]).toHaveLength(1);
  });

  it("lets the CDN keep it until the next Tuesday, a day at most, and briefly while a week waits", () => {
    expect(mostHeldMaxAge(new Date("2026-11-02T23:00:00Z"))).toBe(3600);
    expect(mostHeldMaxAge(new Date("2026-10-29T00:00:00Z"))).toBe(86_400);
    expect(mostHeldMaxAge(new Date("2026-11-02T23:59:59.5Z"))).toBe(60);
    // A week still waiting for its records is asked again in five minutes.
    expect(mostHeldMaxAge(new Date("2026-10-29T00:00:00Z"), false)).toBe(300);
  });
});
