import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setSqlClient, type SqlClient } from "@/lib/server/db";
import { makeTestDb } from "@/lib/server/pglite-test-db";
import { writeMarks } from "@/lib/server/marks";
import { savePortfolioDay } from "@/lib/server/portfolio";
import { dailyCap, recurringDailyCap, retryPendingSends, setBackoff, setEmailTransport, weeklyDailyCap } from "@/lib/server/email/send";
import type { EmailTransport, OutgoingEmail } from "@/lib/server/email/resend";
import { setPref, suppress } from "@/lib/server/email/store";
import { isoWeekKey, runWeeklySummaries, weeklyNotice, weeklyWindow } from "./weekly";

/**
 * The weekly summary against the real schema: who gets one (the switch,
 * off by default), what it says from stored days only, one per person per
 * week, the retry on the mornings after, and its share of the day's cap.
 */

let sql: SqlClient;
let close: () => Promise<void>;
let sent: OutgoingEmail[];
let answer: Awaited<ReturnType<EmailTransport>>;

const MONDAY = new Date("2026-09-28T06:05:00Z");
const TUESDAY = new Date("2026-09-29T06:05:00Z");
const THURSDAY = new Date("2026-10-01T06:05:00Z");

beforeAll(async () => {
  const db = await makeTestDb();
  sql = db.sql;
  close = db.close;
  setSqlClient(sql);
  setBackoff([]);
  vi.stubEnv("EMAIL_TOKEN_SECRET", "weekly-db-test-secret");
});

afterAll(async () => {
  setEmailTransport(null);
  setBackoff(null);
  setSqlClient(null);
  vi.unstubAllEnvs();
  await close();
});

beforeEach(async () => {
  sent = [];
  answer = { ok: true, id: "re_test" };
  setEmailTransport(async (email) => {
    sent.push(email);
    return answer;
  });
  for (const table of [
    "salutes",
    "friends",
    "recurring_runs",
    "recurring_plans",
    "limit_orders",
    "order_marks",
    "orders",
    "portfolio_days",
    "marks",
    "email_sends",
    "email_prefs",
    "email_suppressions",
    "user_identities",
    "users",
  ]) {
    await sql.query(`delete from ${table}`);
  }
});

afterEach(() => {
  setEmailTransport(null);
  vi.unstubAllEnvs();
  vi.stubEnv("EMAIL_TOKEN_SECRET", "weekly-db-test-secret");
});

let people = 0;
async function account(email: string | null): Promise<string> {
  people += 1;
  const rows = (await sql.query(`insert into users (privy_did, wallet_address, email) values ($1, $2, $3) returning id`, [
    `did:privy:weekly-${people}`,
    `0x${String(people).padStart(40, "0")}`,
    email,
  ])) as { id: string }[];
  const id = rows[0].id;
  if (email) {
    await sql.query(
      `insert into user_identities (user_id, kind, value, is_primary, verified_at, proof) values ($1, 'email', $2, true, now(), 'privy_email')`,
      [id, email],
    );
  }
  return id;
}

let intents = 0;
async function order(userId: string, at: string, quantity: number, usd: number, spy: number): Promise<void> {
  intents += 1;
  const rows = (await sql.query(
    `insert into orders (user_id, intent_tx, direction, listing_symbol, listing_address, quantity, usd_value, placed_at, filled_at)
     values ($1, $2, 'buy', 'NVDA', '0xnvda', $3, $4, $5::timestamptz, $5::timestamptz) returning id`,
    [userId, `0x${String(intents).padStart(64, "0")}`, quantity, usd, at],
  )) as { id: string }[];
  await sql.query(`insert into order_marks (order_id, symbol, price) values ($1, 'SPY', $2)`, [rows[0].id, spy]);
}

const DAYS = ["2026-09-16", "2026-09-17", "2026-09-18", "2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25"];
const NVDA = [100, 101, 100, 102, 104, 103, 105, 110];
const SPY = [500, 501, 500, 501, 502, 503, 504, 505];

/** Bought one NVIDIA on the 16th and half another on Tuesday the 22nd; a stored day for every close. */
async function seedHistory(userId: string): Promise<void> {
  await writeMarks("NVDA", DAYS.map((day, index) => ({ day, close: NVDA[index] })), []);
  await writeMarks("SPY", DAYS.map((day, index) => ({ day, close: SPY[index] })), []);
  await order(userId, "2026-09-16T15:00:00Z", 1, 100, 500);
  await order(userId, "2026-09-22T15:00:00Z", 0.5, 52, 502);
  for (const [index, day] of DAYS.entries()) {
    const quantity = day >= "2026-09-22" ? 1.5 : 1;
    await savePortfolioDay(
      userId,
      day,
      { value: quantity * NVDA[index], holdings: [{ symbol: "NVDA", quantity, price: NVDA[index], source: "mark" }] },
      "snapshot",
      `${day}T22:10:00Z`,
    );
  }
}

describe("the week", () => {
  it("summarises the ISO week before, on Monday to Wednesday only", () => {
    expect(weeklyWindow(MONDAY)).toMatchObject({ monday: "2026-09-21", sunday: "2026-09-27", key: "2026-W39" });
    expect(weeklyWindow(new Date("2026-09-30T06:05:00Z"))?.key).toBe("2026-W39");
    expect(weeklyWindow(THURSDAY)).toBeNull();
    expect(weeklyWindow(new Date("2026-10-04T06:05:00Z"))).toBeNull();
    expect(isoWeekKey("2026-12-28")).toBe("2026-W53");
    expect(isoWeekKey("2027-01-04")).toBe("2027-W01");
    expect(isoWeekKey("2025-12-29")).toBe("2026-W01");
  });

  it("keeps a quarter of the day's cap, and never takes what orders and friends keep", () => {
    const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;
    expect(weeklyDailyCap(env({}))).toBe(22);
    expect(weeklyDailyCap(env({ EMAIL_DAILY_CAP: "10" }))).toBe(2);
    // 10 a day: 3 kept for orders and friends, 5 for reminders, so at most 2 for summaries.
    expect(weeklyDailyCap(env({ EMAIL_DAILY_CAP: "10", EMAIL_WEEKLY_DAILY_CAP: "50" }))).toBe(2);
    // The overrides the review feared: 60 + 40 of 90 would leave orders nothing.
    const both = env({ EMAIL_RECURRING_DAILY_CAP: "60", EMAIL_WEEKLY_DAILY_CAP: "40" });
    expect(recurringDailyCap(both)).toBe(60);
    expect(weeklyDailyCap(both)).toBe(7);
    for (const vars of [both, env({ EMAIL_RECURRING_DAILY_CAP: "90", EMAIL_WEEKLY_DAILY_CAP: "90" }), env({ EMAIL_DAILY_CAP: "3", EMAIL_WEEKLY_DAILY_CAP: "3" })]) {
      expect(dailyCap(vars) - recurringDailyCap(vars) - weeklyDailyCap(vars)).toBeGreaterThanOrEqual(Math.ceil(dailyCap(vars) / 4));
    }
  });
});

describe("weeklyNotice", () => {
  it("tells the week from stored days, as the chart's one week range does", async () => {
    const id = await account("sailor@example.com");
    await seedHistory(id);
    const friend = await account(null);
    const [a, b] = [id, friend].sort();
    await sql.query(`insert into friends (a_id, b_id, since) values ($1, $2, '2026-09-23T10:00:00Z')`, [a, b]);
    await sql.query(`insert into salutes (giver_id, recipient_id, first_at) values ($1, $2, '2026-09-24T10:00:00Z')`, [friend, id]);
    await sql.query(
      `insert into limit_orders (user_id, intent_tx, direction, listing_symbol, listing_address, input_raw, input_decimals, min_output_raw, output_decimals, limit_price, status, closed_at)
       values ($1, '0xlimit', 'buy', 'NVDA', '0xnvda', 1, 6, 1, 18, 90, 'expired', '2026-09-24T12:00:00Z')`,
      [id],
    );
    const plan = (await sql.query(
      `insert into recurring_plans (user_id, listing_symbol, usd, cadence, weekday, time_zone, next_due_at)
       values ($1, 'SPY', 20, 'weekly', 1, 'Europe/Amsterdam', '2026-10-04T22:00:00Z') returning id`,
      [id],
    )) as { id: string }[];
    await sql.query(
      `insert into recurring_runs (plan_id, user_id, due_at, status, listing_symbol, usd) values ($1, $2, '2026-09-20T22:00:00Z', 'skipped', 'SPY', 20)`,
      [plan[0].id, id],
    );

    const notice = await weeklyNotice(id, weeklyWindow(MONDAY)!);
    // Time weighted: the half bought on Tuesday is money added, not a gain.
    const growth = (102 / 100) * (156 / (102 + 52)) * (154.5 / 156) * (157.5 / 154.5) * (165 / 157.5);
    expect(notice).toEqual({
      type: "weekly",
      weekOf: "21 September",
      closeDay: "Friday 25 September",
      account: {
        worth: "$165.00",
        change: `+${((growth - 1) * 100).toFixed(2)}%`,
        benchmark: { name: "S&P 500 ETF", change: "+1.00%" },
      },
      holdings: [{ name: "NVIDIA", worth: "$165.00", move: "+10.00%" }],
      holdingsRest: null,
      orders: { buys: 1, sells: 0, limitsFilled: 0, limitsExpired: 1 },
      // The run was due Monday the 21st in Amsterdam (Sunday 22:00 UTC): before the UTC week, so not counted.
      recurring: { placed: 0, skipped: 0, next: { name: "S&P 500 ETF", day: "Monday 5 October" } },
      friends: { added: 1, salutes: 1 },
    });
  });

  it("counts a filled limit order once: in what filled, and as one of them a limit order", async () => {
    const id = await account("sailor@example.com");
    await seedHistory(id);
    // The limit buy placed the week before and filled on Thursday: its order row, and its limit_orders row.
    const filled = (await sql.query(
      `insert into orders (user_id, intent_tx, direction, listing_symbol, listing_address, quantity, usd_value, placed_at, filled_at, order_type, limit_price)
       values ($1, '0xlimitfill', 'buy', 'NVDA', '0xnvda', 0.1, 10, '2026-09-17T10:00:00Z', '2026-09-24T15:00:00Z', 'limit', 100) returning id`,
      [id],
    )) as { id: string }[];
    expect(filled).toHaveLength(1);
    await sql.query(
      `insert into limit_orders (user_id, intent_tx, direction, listing_symbol, listing_address, input_raw, input_decimals, min_output_raw, output_decimals, limit_price, status, closed_at)
       values ($1, '0xlimitfill', 'buy', 'NVDA', '0xnvda', 1, 6, 1, 18, 100, 'filled', '2026-09-24T15:00:00Z')`,
      [id],
    );
    const notice = await weeklyNotice(id, weeklyWindow(MONDAY)!);
    expect(notice.orders).toEqual({ buys: 2, sells: 0, limitsFilled: 1, limitsExpired: 0 });
    const { composeNotice } = await import("@/lib/server/email/compose");
    const facts = composeNotice(notice, "https://www.berthmarkets.com").sections?.find((section) => section.heading === "Orders")?.facts;
    expect(facts).toEqual([{ label: "Filled", value: "2 buys, of which 1 was a limit order" }]);
  });

  it("counts as let pass only what went unsigned or the person skipped, never a pause or a merge", async () => {
    const id = await account("sailor@example.com");
    const plan = async (paused: boolean, updatedAt: string) =>
      (
        (await sql.query(
          `insert into recurring_plans (user_id, listing_symbol, usd, cadence, weekday, time_zone, next_due_at, paused, updated_at)
           values ($1, 'SPY', 20, 'weekly', 2, 'UTC', '2026-10-06T00:00:00Z', $2, $3) returning id`,
          [id, paused, updatedAt],
        )) as { id: string }[]
      )[0].id;
    const run = (planId: string, due: string, closed: string) =>
      sql.query(
        `insert into recurring_runs (plan_id, user_id, due_at, status, listing_symbol, usd, closed_at) values ($1, $2, $3, 'skipped', 'SPY', 20, $4)`,
        [planId, id, due, closed],
      );
    const kept = await plan(false, "2026-09-01T00:00:00Z");
    await run(kept, "2026-09-22T00:00:00Z", "2026-09-25T06:05:00Z"); // three days unsigned: let pass
    await run(kept, "2026-09-23T00:00:00Z", "2026-09-23T09:00:00Z"); // the person skipped it: let pass
    const paused = await plan(true, "2026-09-24T10:00:00Z");
    await run(paused, "2026-09-24T00:00:00Z", "2026-09-24T10:00:00.010Z"); // closed by the pause: not counted
    const resumed = await plan(false, "2026-09-26T10:00:00Z");
    await run(resumed, "2026-09-24T00:00:00Z", "2026-09-24T10:00:00Z"); // paused then, resumed since: not counted
    const merged = await plan(true, "2026-09-24T12:00:00Z");
    await run(merged, "2026-09-24T00:00:00Z", "2026-09-24T12:00:00Z"); // a merge, the same statement: not counted
    const notice = await weeklyNotice(id, weeklyWindow(MONDAY)!);
    expect(notice.recurring).toMatchObject({ placed: 0, skipped: 2 });
  });

  it("tells what the list leaves out, so the holdings add up to the account's worth", async () => {
    const id = await account("sailor@example.com");
    const holdings = [
      { symbol: "NVDA", quantity: 1, price: 100, source: "mark" as const },
      { symbol: "TSLA", quantity: 1, price: 40, source: "mark" as const },
      // Not a listing Berth names, and dust: the first is told as one more, the dust is not.
      { symbol: "UNLISTED", quantity: 2, price: 5, source: "mark" as const },
      { symbol: "AAPL", quantity: 0.0001, price: 1, source: "mark" as const },
    ];
    await savePortfolioDay(id, "2026-09-25", { value: 150, holdings }, "snapshot", "2026-09-25T22:10:00Z");
    const notice = await weeklyNotice(id, weeklyWindow(MONDAY)!);
    expect(notice.holdings.map((holding) => holding.name)).toEqual(["NVIDIA", "Tesla"]);
    expect(notice.holdingsRest).toEqual({ count: 1, worth: "$10.00" });
    const { composeNotice } = await import("@/lib/server/email/compose");
    const facts = composeNotice(notice, "https://www.berthmarkets.com").sections?.find((section) => section.heading === "What you hold")?.facts;
    expect(facts?.at(-1)).toEqual({ label: "And 1 more", value: "$10.00" });
  });

  it("starts each holding's move where the account's change starts, after a market holiday too", async () => {
    const id = await account("sailor@example.com");
    // The Friday before the week is a holiday: no close, no stored day.
    const days = DAYS.filter((day) => day !== "2026-09-18");
    const nvda = days.map((day) => NVDA[DAYS.indexOf(day)]);
    await writeMarks("NVDA", days.map((day, index) => ({ day, close: nvda[index] })), []);
    await writeMarks("SPY", days.map((day) => ({ day, close: SPY[DAYS.indexOf(day)] })), []);
    await order(id, "2026-09-16T15:00:00Z", 1, 100, 500);
    for (const [index, day] of days.entries()) {
      await savePortfolioDay(id, day, { value: nvda[index], holdings: [{ symbol: "NVDA", quantity: 1, price: nvda[index], source: "mark" }] }, "snapshot", `${day}T22:10:00Z`);
    }
    const notice = await weeklyNotice(id, weeklyWindow(MONDAY)!);
    // The account's week runs from Monday's close (102) to Friday's (110), and so does the holding's move.
    expect(notice.account?.change).toBe("+7.84%");
    expect(notice.holdings).toEqual([{ name: "NVIDIA", worth: "$110.00", move: "+7.84%" }]);
  });

  it("leaves out a holding's move whose start close is older than the week before", async () => {
    const id = await account("sailor@example.com");
    await writeMarks("NVDA", [{ day: "2026-09-01", close: 50 }, { day: "2026-09-25", close: 110 }], []);
    await savePortfolioDay(id, "2026-09-25", { value: 110, holdings: [{ symbol: "NVDA", quantity: 1, price: 110, source: "mark" }] }, "snapshot", "2026-09-25T22:10:00Z");
    const notice = await weeklyNotice(id, weeklyWindow(MONDAY)!);
    expect(notice.holdings).toEqual([{ name: "NVIDIA", worth: "$110.00", move: null }]);
  });

  it("stops at the week's end: a later day or order does not change it", async () => {
    const id = await account("sailor@example.com");
    await seedHistory(id);
    const before = await weeklyNotice(id, weeklyWindow(MONDAY)!);
    await writeMarks("NVDA", [{ day: "2026-09-28", close: 200 }], []);
    await order(id, "2026-09-28T15:00:00Z", 1, 200, 510);
    await savePortfolioDay(
      id,
      "2026-09-28",
      { value: 500, holdings: [{ symbol: "NVDA", quantity: 2.5, price: 200, source: "mark" }] },
      "snapshot",
      "2026-09-28T22:10:00Z",
    );
    expect(await weeklyNotice(id, weeklyWindow(TUESDAY)!)).toEqual(before);
  });

  it("leaves the account out when no day of the week is stored, and says nothing it cannot tell", async () => {
    const id = await account("sailor@example.com");
    const notice = await weeklyNotice(id, weeklyWindow(MONDAY)!);
    expect(notice).toMatchObject({ closeDay: null, account: null, holdings: [], orders: null, recurring: null, friends: null });
  });

  it("gives the value without a change when the week is not yet filled", async () => {
    const id = await account("sailor@example.com");
    await writeMarks("NVDA", DAYS.map((day, index) => ({ day, close: NVDA[index] })), []);
    await writeMarks("SPY", DAYS.map((day, index) => ({ day, close: SPY[index] })), []);
    await order(id, "2026-09-23T15:00:00Z", 1, 103, 503);
    for (const day of ["2026-09-23", "2026-09-24", "2026-09-25"]) {
      const close = NVDA[DAYS.indexOf(day)];
      await savePortfolioDay(id, day, { value: close, holdings: [{ symbol: "NVDA", quantity: 1, price: close, source: "mark" }] }, "snapshot", `${day}T22:10:00Z`);
    }
    const notice = await weeklyNotice(id, weeklyWindow(MONDAY)!);
    expect(notice.account).toEqual({ worth: "$110.00", change: null, benchmark: null });
    expect(notice.holdings).toEqual([{ name: "NVIDIA", worth: "$110.00", move: "+10.00%" }]);
  });
});

describe("runWeeklySummaries", () => {
  it("writes only to people who switched it on, once a week", async () => {
    const off = await account("quiet@example.com");
    await seedHistory(off);
    const on = await account("sailor@example.com");
    await seedHistory(on);
    await setPref(on, "weekly", true);

    expect(await runWeeklySummaries({ now: MONDAY })).toEqual({ week: "2026-W39", sent: 1, empty: 0, notSent: 0, deferred: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("sailor@example.com");
    expect(sent[0].subject).toBe("Your Berth week of 21 September");
    expect(sent[0].text).toContain("Worth at the close: $165.00");
    expect(sent[0].text).toContain("S&P 500 ETF, same days: +1.00%");
    // One name for the fund in the whole email.
    expect(sent[0].text).not.toContain("S&P 500 fund");
    expect(sent[0].headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    const rows = (await sql.query(`select type, ref, status from email_sends`)) as { type: string; ref: string; status: string }[];
    expect(rows).toEqual([{ type: "weekly", ref: `2026-W39:${on}`, status: "sent" }]);

    // Tuesday's run finds it sent; Thursday's sends none.
    expect(await runWeeklySummaries({ now: TUESDAY })).toMatchObject({ sent: 0, notSent: 0 });
    expect(await runWeeklySummaries({ now: THURSDAY })).toEqual({ week: null, sent: 0, empty: 0, notSent: 0, deferred: 0 });
    expect(sent).toHaveLength(1);
  });

  it("sends nothing for an empty week, to a suppressed address, or once switched off", async () => {
    const empty = await account("empty@example.com");
    await setPref(empty, "weekly", true);
    const bounced = await account("gone@example.com");
    await seedHistory(bounced);
    await setPref(bounced, "weekly", true);
    await suppress("gone@example.com", "bounce", null);
    const changed = await account("changed@example.com");
    await seedHistory(changed);
    await setPref(changed, "weekly", true);
    await setPref(changed, "weekly", false);

    expect(await runWeeklySummaries({ now: MONDAY })).toMatchObject({ sent: 0, empty: 1 });
    expect(sent).toHaveLength(0);
  });

  it("tries again the next morning when a send failed", async () => {
    const id = await account("sailor@example.com");
    await seedHistory(id);
    await setPref(id, "weekly", true);
    answer = { ok: false, error: "http_500" };
    expect(await runWeeklySummaries({ now: MONDAY })).toMatchObject({ sent: 0, notSent: 1 });
    // Not again the same morning.
    expect(await runWeeklySummaries({ now: MONDAY })).toMatchObject({ sent: 0, notSent: 0 });
    await sql.query(`update email_sends set created_at = created_at - interval '1 day'`);
    answer = { ok: true, id: "re_again" };
    expect(await runWeeklySummaries({ now: TUESDAY })).toMatchObject({ sent: 1 });
    expect(sent).toHaveLength(2);
    expect(sent[1].idempotencyKey).toBe(`berth-weekly-2026-W39:${id}`);
  });

  it("stops at its share of the day and at its deadline, leaving the rest for tomorrow", async () => {
    const ids: string[] = [];
    for (const n of [1, 2, 3]) {
      const id = await account(`sailor${n}@example.com`);
      await seedHistory(id);
      await setPref(id, "weekly", true);
      ids.push(id);
    }
    vi.stubEnv("EMAIL_WEEKLY_DAILY_CAP", "2");
    expect(await runWeeklySummaries({ now: MONDAY })).toMatchObject({ sent: 2 });
    // The share is used up today; the third waits.
    expect(await runWeeklySummaries({ now: MONDAY })).toMatchObject({ sent: 0 });
    await sql.query(`update email_sends set created_at = created_at - interval '1 day'`);
    let tick = 0;
    expect(await runWeeklySummaries({ now: TUESDAY, deadline: 1, clock: () => tick++ })).toMatchObject({ sent: 1, deferred: 0 });
    expect(sent.map((email) => email.to).sort()).toEqual(["sailor1@example.com", "sailor2@example.com", "sailor3@example.com"]);
  });

  it("reads past empty weeks and failed builds, so they never hold the front of the queue", async () => {
    vi.stubEnv("EMAIL_WEEKLY_DAILY_CAP", "2");
    // The oldest switches: two empty accounts and one whose build throws.
    const empties = [await account("empty1@example.com"), await account("empty2@example.com")];
    for (const id of empties) await setPref(id, "weekly", true);
    const broken = await account("broken@example.com");
    await seedHistory(broken);
    await setPref(broken, "weekly", true);
    const real = await account("sailor@example.com");
    await seedHistory(real);
    await setPref(real, "weekly", true);
    await sql.query(`update email_prefs set updated_at = now() - interval '1 hour' where user_id = any($1)`, [[...empties, broken]]);

    const build = async (userId: string, window: NonNullable<ReturnType<typeof weeklyWindow>>) => {
      if (userId === broken) throw new Error("marks down");
      return weeklyNotice(userId, window);
    };
    expect(await runWeeklySummaries({ now: MONDAY, build })).toEqual({ week: "2026-W39", sent: 1, empty: 2, notSent: 1, deferred: 0 });
    expect(sent.map((email) => email.to)).toEqual(["sailor@example.com"]);
    const rows = (await sql.query(`select ref, status, error from email_sends order by ref`)) as { ref: string; status: string; error: string | null }[];
    expect(rows).toHaveLength(4);
    expect(rows.find((row) => row.ref.endsWith(empties[0]))).toMatchObject({ status: "failed", error: "empty" });
    expect(rows.find((row) => row.ref.endsWith(broken))).toMatchObject({ status: "failed", error: "build" });

    // Nobody is tried twice the same morning; the next morning only the failed build is tried again, and the empty weeks are done.
    expect(await runWeeklySummaries({ now: MONDAY, build })).toEqual({ week: "2026-W39", sent: 0, empty: 0, notSent: 0, deferred: 0 });
    await sql.query(`update email_sends set created_at = created_at - interval '1 day'`);
    expect(await runWeeklySummaries({ now: TUESDAY })).toEqual({ week: "2026-W39", sent: 1, empty: 0, notSent: 0, deferred: 0 });
    expect(sent.map((email) => email.to)).toEqual(["sailor@example.com", "broken@example.com"]);
  });

  it("stops once its share is sent, leaving the rest of the batch for tomorrow", async () => {
    vi.stubEnv("EMAIL_WEEKLY_DAILY_CAP", "1");
    for (const n of [1, 2, 3]) {
      const id = await account(`deck${n}@example.com`);
      await seedHistory(id);
      await setPref(id, "weekly", true);
    }
    expect(await runWeeklySummaries({ now: MONDAY })).toEqual({ week: "2026-W39", sent: 1, empty: 0, notSent: 0, deferred: 2 });
    expect(sent).toHaveLength(1);
  });

  it("picks by the same address rule the send uses", async () => {
    vi.stubEnv("EMAIL_WEEKLY_DAILY_CAP", "1");
    // Stored unnormalised and suppressed in its normal form: the send would refuse it, so it is not picked.
    const shouting = await account(" Gone@Example.com ");
    await seedHistory(shouting);
    await setPref(shouting, "weekly", true);
    await suppress("gone@example.com", "bounce", null);
    // Not an address at all: the send would find none.
    const broken = await account("not-an-address");
    await seedHistory(broken);
    await setPref(broken, "weekly", true);
    const real = await account("sailor@example.com");
    await seedHistory(real);
    await setPref(real, "weekly", true);
    await sql.query(`update email_prefs set updated_at = now() - interval '1 hour' where user_id = any($1)`, [[shouting, broken]]);
    expect(await runWeeklySummaries({ now: MONDAY })).toEqual({ week: "2026-W39", sent: 1, empty: 0, notSent: 0, deferred: 0 });
    expect(sent.map((email) => email.to)).toEqual(["sailor@example.com"]);
  });

  it("lets a summary left pending go once its week is over, and sends it while the week still stands", async () => {
    const id = await account("sailor@example.com");
    await seedHistory(id);
    await setPref(id, "weekly", true);
    const notice = await weeklyNotice(id, weeklyWindow(MONDAY)!);
    const ref = `2026-W39:${id}`;
    const pending = () =>
      sql.query(
        `insert into email_sends (user_id, type, ref, notice, created_at) values ($1, 'weekly', $2, $3::jsonb, now() - interval '20 minutes')
         on conflict (type, ref) do update set status = 'pending', notice = excluded.notice, created_at = excluded.created_at, attempts = 1`,
        [id, ref, JSON.stringify(notice)],
      );
    await pending();
    expect(await retryPendingSends({ now: THURSDAY })).toEqual({ retried: 1, sent: 0, gaveUp: 1 });
    expect(sent).toHaveLength(0);
    expect(await sql.query(`select status, error from email_sends where ref = $1`, [ref])).toEqual([{ status: "failed", error: "week_past" }]);
    await pending();
    expect(await retryPendingSends({ now: TUESDAY })).toEqual({ retried: 1, sent: 1, gaveUp: 0 });
    expect(sent).toHaveLength(1);
  });

  it("starts nobody after its deadline", async () => {
    const id = await account("sailor@example.com");
    await seedHistory(id);
    await setPref(id, "weekly", true);
    expect(await runWeeklySummaries({ now: MONDAY, deadline: 0, clock: () => 1 })).toMatchObject({ sent: 0, deferred: 1 });
    expect(sent).toHaveLength(0);
  });
});
