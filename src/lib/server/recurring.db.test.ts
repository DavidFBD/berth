import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setSqlClient, type SqlClient } from "@/lib/server/db";
import { makeTestDb } from "@/lib/server/pglite-test-db";
import { setEmailTransport } from "@/lib/server/email/send";
import type { OutgoingEmail } from "@/lib/server/email/resend";
import { setPref } from "@/lib/server/email/store";
import { lazyPrices, remindByEmail } from "@/lib/server/morning";
import { saveOrder } from "@/lib/server/orders";
import type { OrderRecord } from "@/lib/orders";
import { checkPlan, type PlanInput } from "@/lib/recurring";
import {
  ageRuns,
  createPlan,
  deletePlan,
  listPlans,
  makeDueRuns,
  openRun,
  limitOrderDollars,
  placeMatchingRun,
  placeRunForLimitOrder,
  readyRuns,
  runRecurringMorning,
  setPaused,
  skipRun,
  updatePlan,
  type PlanWrite,
} from "./recurring";

/**
 * Recurring buys against the real schema: the ten plan cap, one run per
 * plan per day however often it is asked, the morning's one reminder per
 * run, the run's life (opened, placed by a matching order, skipped by the
 * person or by three days), and pause.
 */

let sql: SqlClient;
let close: () => Promise<void>;
let sent: OutgoingEmail[];

beforeAll(async () => {
  const db = await makeTestDb();
  sql = db.sql;
  close = db.close;
  setSqlClient(sql);
  vi.stubEnv("EMAIL_TOKEN_SECRET", "recurring-db-test-secret");
});

afterAll(async () => {
  setEmailTransport(null);
  setSqlClient(null);
  vi.unstubAllEnvs();
  await close();
});

beforeEach(async () => {
  sent = [];
  setEmailTransport(async (email) => {
    sent.push(email);
    return { ok: true, id: "re_test" };
  });
  for (const table of ["recurring_runs", "recurring_plans", "pour_claims", "orders", "limit_orders", "email_sends", "email_prefs", "user_identities", "users"]) {
    await sql.query(`delete from ${table}`);
  }
});

afterEach(() => setEmailTransport(null));

async function account(email: string | null = "sailor@example.com"): Promise<string> {
  const rows = (await sql.query(`insert into users (privy_did, wallet_address, email) values ($1, $2, $3) returning id`, [
    `did:privy:${Math.random().toString(36).slice(2)}`,
    `0x${Math.random().toString(16).slice(2).padEnd(40, "0").slice(0, 40)}`,
    email,
  ])) as { id: string }[];
  if (email) {
    await sql.query(
      `insert into user_identities (user_id, kind, value, is_primary, verified_at, proof) values ($1, 'email', $2, true, now(), 'privy_email')`,
      [rows[0].id, email],
    );
  }
  return rows[0].id;
}

function plan(overrides: Partial<PlanInput> = {}): PlanWrite {
  const checked = checkPlan(
    { listing: "NVDA", usd: 50, cadence: "weekly", weekday: 1, timeZone: "Europe/Amsterdam", ...overrides },
    { limitAllowed: true },
  );
  if (!checked.ok) throw new Error(checked.reason);
  return checked.plan;
}

// Wednesday 30 September 2026. The first Monday after is 5 October, which starts at 22:00 UTC on the 4th in Amsterdam.
const WED = Date.parse("2026-09-30T10:00:00Z");
const MONDAY_START = Date.parse("2026-10-04T22:00:00Z");
const MONDAY_MORNING = Date.parse("2026-10-05T06:05:00Z");
const DAY = 86_400_000;

describe("plans", () => {
  it("holds at most ten an account", async () => {
    const user = await account();
    for (let i = 0; i < 10; i += 1) expect(await createPlan(user, plan(), { now: WED })).not.toBe("too_many");
    expect(await createPlan(user, plan(), { now: WED })).toBe("too_many");
    // Written past the statement's own check (two creates at nine at once), the trigger still refuses the eleventh.
    await expect(
      sql.query(
        `insert into recurring_plans (user_id, listing_symbol, usd, cadence, weekday, time_zone, next_due_at) values ($1, 'NVDA', 20, 'weekly', 1, 'UTC', now())`,
        [user],
      ),
    ).rejects.toThrow(/recurring plans cap/);
    // Another account is its own count.
    expect(await createPlan(await account(null), plan(), { now: WED })).not.toBe("too_many");
  });

  it("the database refuses what the rules refuse, whoever writes", async () => {
    const user = await account();
    await expect(
      sql.query(
        `insert into recurring_plans (user_id, listing_symbol, usd, cadence, weekday, time_zone, next_due_at) values ($1, 'NVDA', 20000, 'weekly', 1, 'UTC', now())`,
        [user],
      ),
    ).rejects.toThrow();
    await expect(
      sql.query(
        `insert into recurring_plans (user_id, listing_symbol, usd, cadence, weekday, month_day, time_zone, next_due_at) values ($1, 'NVDA', 20, 'weekly', 1, 3, 'UTC', now())`,
        [user],
      ),
    ).rejects.toThrow();
  });

  it("first comes due on the next day it names, in the person's zone", async () => {
    const user = await account();
    const created = await createPlan(user, plan(), { now: WED });
    expect(created !== "too_many" && created.nextDueAt).toBe(new Date(MONDAY_START).toISOString());
  });

  it("resumes only while fewer than ten others run, as after a merge left the extras paused", async () => {
    const user = await account();
    const ids: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      const created = await createPlan(user, plan(), { now: WED });
      if (created === "too_many") throw new Error("cap");
      ids.push(created.id);
    }
    // Two more, paused, moved in by update as a merge brings them (the insert cap would refuse an eleventh).
    const other = await account(null);
    const extras = (await sql.query(
      `insert into recurring_plans (user_id, listing_symbol, usd, cadence, weekday, time_zone, next_due_at, paused)
       select $1, 'TSLA', 20, 'weekly', 1, 'UTC', now(), true from generate_series(1, 2) returning id`,
      [other],
    )) as { id: string }[];
    await sql.query(`update recurring_plans set user_id = $1 where user_id = $2`, [user, other]);
    expect(await setPaused(user, extras[0].id, false, WED)).toBe("too_many");
    // Written past the statement's own check, the trigger still refuses an eleventh running plan.
    await expect(sql.query(`update recurring_plans set paused = false where id = $1`, [extras[0].id])).rejects.toThrow(/recurring plans cap/);
    // Pausing one makes room for one, and no more.
    await setPaused(user, ids[0], true, WED);
    expect(await setPaused(user, extras[0].id, false, WED)).toMatchObject({ id: extras[0].id, paused: false });
    expect(await setPaused(user, extras[1].id, false, WED)).toBe("too_many");
    // Resuming a plan already running is not a new one.
    expect(await setPaused(user, ids[1], false, WED)).toMatchObject({ paused: false });
    const running = (await listPlans(user)).filter((listed) => !listed.paused);
    expect(running).toHaveLength(10);
  });

  it("only its own account can pause or delete it", async () => {
    const user = await account();
    const other = await account(null);
    const created = await createPlan(user, plan(), { now: WED });
    if (created === "too_many") throw new Error("cap");
    expect(await setPaused(other, created.id, true)).toBeNull();
    expect(await deletePlan(other, created.id)).toBe(false);
    expect(await deletePlan(user, created.id)).toBe(true);
    expect(await listPlans(user)).toEqual([]);
  });
});

describe("runs", () => {
  it("one run per plan per day, however often it is asked, and the next date moves on", async () => {
    const user = await account();
    await createPlan(user, plan(), { now: WED });
    const [first, second] = await Promise.all([
      makeDueRuns({ cutoff: MONDAY_MORNING }),
      makeDueRuns({ cutoff: MONDAY_MORNING }),
    ]);
    expect(first.length + second.length).toBe(1);
    expect(await makeDueRuns({ cutoff: MONDAY_MORNING })).toEqual([]);
    const [listed] = await listPlans(user);
    expect(listed.nextDueAt).toBe("2026-10-11T22:00:00.000Z");
    expect(listed.runs).toHaveLength(1);
  });

  it("a plan that missed weeks gets only its latest run, never a backlog", async () => {
    const user = await account();
    await createPlan(user, plan(), { now: WED });
    const made = await makeDueRuns({ cutoff: MONDAY_START + 21 * DAY + 3_600_000 });
    expect(made).toHaveLength(1);
    expect(new Date(made[0].dueAt).toISOString()).toBe("2026-10-25T23:00:00.000Z");
  });

  it("the morning sends one reminder per run, and a second morning sends none", async () => {
    const user = await account();
    await createPlan(user, plan({ listing: "SPY", usd: 20 }), { now: WED });
    const first = await runRecurringMorning({ now: MONDAY_MORNING, remind: remindByEmail });
    expect(first).toMatchObject({ made: 1, emailed: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe("Your Monday S&P 500 ETF buy is ready to sign");
    expect(sent[0].text).toContain("?open=SPY&side=buy&usd=20&run=");
    expect(sent[0].headers["List-Unsubscribe"]).toBeDefined();
    const second = await runRecurringMorning({ now: MONDAY_MORNING + 60_000, remind: remindByEmail });
    expect(second).toMatchObject({ made: 0, emailed: 0 });
    expect(sent).toHaveLength(1);
  });

  it("a run a page load made first still gets its one email in the morning", async () => {
    const user = await account();
    await createPlan(user, plan(), { now: WED });
    await makeDueRuns({ cutoff: MONDAY_START + 60_000, userId: user });
    const morning = await runRecurringMorning({ now: MONDAY_MORNING, remind: remindByEmail });
    expect(morning).toMatchObject({ made: 0, emailed: 1 });
    await runRecurringMorning({ now: MONDAY_MORNING + DAY, remind: remindByEmail });
    expect(sent).toHaveLength(1);
  });

  it("respects the switch: reminders off, no email, the strip still shows", async () => {
    const user = await account();
    await setPref(user, "recurring", false);
    await createPlan(user, plan(), { now: WED });
    const morning = await runRecurringMorning({ now: MONDAY_MORNING, remind: remindByEmail });
    expect(morning).toMatchObject({ made: 1, emailed: 0, notEmailed: 1 });
    expect(sent).toHaveLength(0);
    expect(await readyRuns(user)).toHaveLength(1);
  });

  it("opened, then placed by a matching order, and no longer ready", async () => {
    const user = await account();
    await createPlan(user, plan(), { now: WED });
    const [run] = await makeDueRuns({ cutoff: MONDAY_MORNING });
    expect(await openRun(user, run.id, MONDAY_MORNING)).toBe("opened");
    // Another listing, or another amount, is not this run.
    expect(await placeMatchingRun({ userId: user, symbol: "TSLA", usd: 50, at: MONDAY_MORNING + 60_000 })).toBeNull();
    expect(await placeMatchingRun({ userId: user, symbol: "NVDA", usd: 80, at: MONDAY_MORNING + 60_000 })).toBeNull();
    expect(await placeMatchingRun({ userId: user, symbol: "NVDA", usd: 49.1, at: MONDAY_MORNING + 60_000 })).toBe(run.id);
    expect(await readyRuns(user)).toEqual([]);
    // A second buy the same day answers nothing: the run is already placed.
    expect(await placeMatchingRun({ userId: user, symbol: "NVDA", usd: 50, at: MONDAY_MORNING + 120_000 })).toBeNull();
    const [listed] = await listPlans(user);
    expect(listed.runs[0].status).toBe("placed");
  });

  it("skipped by the person, or by three days, and skipping is final", async () => {
    const user = await account();
    await createPlan(user, plan(), { now: WED });
    await createPlan(user, plan({ listing: "TSLA" }), { now: WED });
    const runs = await makeDueRuns({ cutoff: MONDAY_MORNING });
    expect(runs).toHaveLength(2);
    expect(await skipRun(user, runs[0].id, MONDAY_MORNING)).toBe("skipped");
    expect(await openRun(user, runs[0].id, MONDAY_MORNING)).toBe("skipped");
    const aged = await runRecurringMorning({ now: MONDAY_START + 3 * DAY + 60_000, remind: async () => "retry" as const });
    expect(aged.aged).toBe(1);
    expect(await readyRuns(user)).toEqual([]);
    // An order after the window places nothing.
    expect(await placeMatchingRun({ userId: user, symbol: "TSLA", usd: 50, at: MONDAY_START + 3 * DAY + 120_000 })).toBeNull();
  });

  it("a paused plan makes no runs and lets its waiting run go; resumed, it starts from the next day", async () => {
    const user = await account();
    const created = await createPlan(user, plan(), { now: WED });
    if (created === "too_many") throw new Error("cap");
    await makeDueRuns({ cutoff: MONDAY_MORNING });
    await setPaused(user, created.id, true, MONDAY_MORNING);
    expect(await readyRuns(user)).toEqual([]);
    expect(await makeDueRuns({ cutoff: MONDAY_MORNING + 14 * DAY })).toEqual([]);
    const resumed = await setPaused(user, created.id, false, MONDAY_MORNING + 16 * DAY);
    expect(resumed).toMatchObject({ nextDueAt: "2026-10-25T23:00:00.000Z" });
  });

  it("a dip plan's run carries its limit price when a live price and the switch allow", async () => {
    const user = await account();
    await createPlan(user, plan({ orderType: "limit", dipPct: 5 }), { now: WED });
    const [run] = await makeDueRuns({ cutoff: MONDAY_MORNING, priceOf: () => 200, limitOn: () => true });
    expect(run.limitPrice).toBe(190);
    expect(run.expires).toBe("2026-10-11");
    await createPlan(user, plan({ listing: "TSLA", orderType: "limit", dipPct: 5 }), { now: WED });
    const [plain] = await makeDueRuns({ cutoff: MONDAY_MORNING, priceOf: () => 200, limitOn: () => false });
    expect(plain.limitPrice).toBeNull();
  });
});

describe("a run keeps the plan it was made from", () => {
  it("an edit after the run is made changes neither what it asks for nor what answers it", async () => {
    const user = await account();
    const created = await createPlan(user, plan({ usd: 100 }), { now: WED });
    if (created === "too_many") throw new Error("cap");
    const [run] = await makeDueRuns({ cutoff: MONDAY_MORNING });
    await updatePlan(user, created.id, plan({ listing: "AAPL", usd: 500 }), MONDAY_MORNING);
    const [ready] = await readyRuns(user);
    expect(ready).toMatchObject({ id: run.id, symbol: "NVDA", usd: 100 });
    expect(await placeMatchingRun({ userId: user, symbol: "AAPL", usd: 500, at: MONDAY_MORNING + 60_000 })).toBeNull();
    expect(await placeMatchingRun({ userId: user, symbol: "NVDA", usd: 100, at: MONDAY_MORNING + 60_000 })).toBe(run.id);
  });
});

function buy(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    intentTx: `0x${Math.random().toString(16).slice(2)}`,
    fillTx: null,
    direction: "buy",
    walletAddress: "0xwallet",
    deliveredTo: null,
    listingSymbol: "NVDA",
    listingAddress: "0xnvda",
    quantity: null,
    minQuantity: "0.3",
    paySymbol: "USDC",
    payChain: "0x38.bsc",
    payAmount: "50",
    feeAmount: "0.2",
    usdValue: "50",
    usdSource: "stable",
    placedAt: new Date(MONDAY_MORNING + 60_000),
    filledAt: null,
    ...overrides,
  };
}

async function runStatus(runId: string) {
  const rows = (await sql.query(`select status, order_id, limit_order_id from recurring_runs where id = $1`, [runId])) as {
    status: string;
    order_id: string | null;
    limit_order_id: string | null;
  }[];
  return rows[0];
}

async function limitBuy(userId: string, paySymbol: string, inputRaw: string, decimals = 6) {
  const intentTx = `0x${Math.random().toString(16).slice(2)}`;
  await sql.query(
    `insert into limit_orders (user_id, intent_tx, direction, listing_symbol, listing_address, pay_symbol, input_raw, input_decimals, min_output_raw, output_decimals, limit_price, placed_at)
     values ($1, $2, 'buy', 'NVDA', '0xnvda', $3, $4, $5, 1, 18, 190, $6)`,
    [userId, intentTx, paySymbol, inputRaw, decimals, new Date(MONDAY_MORNING + 60_000).toISOString()],
  );
  return intentTx;
}

describe("every recorded buy answers its run, once, and only its owner's", () => {
  it("a buy saved later (the evening pass, a recovery, a fill) closes the run, and a replay closes nothing more", async () => {
    const user = await account();
    await createPlan(user, plan(), { now: WED });
    await createPlan(user, plan({ weekday: 2 }), { now: WED });
    const runs = await makeDueRuns({ cutoff: MONDAY_MORNING + DAY });
    expect(runs).toHaveLength(2);
    const order = buy();
    const id = await saveOrder(user, order);
    expect((await runStatus(runs[0].id)).order_id).toBe(id);
    // The same intent again: the upsert answers the same id, and the second run still waits.
    expect(await saveOrder(user, order)).toBe(id);
    expect((await runStatus(runs[1].id)).status).toBe("due");
    expect(await placeMatchingRun({ userId: user, symbol: "NVDA", usd: 50, at: MONDAY_MORNING + 60_000, orderId: id })).toBeNull();
  });

  it("an intent another account recorded first answers only that account's run", async () => {
    const owner = await account();
    const caller = await account(null);
    await createPlan(owner, plan(), { now: WED });
    await createPlan(caller, plan(), { now: WED });
    const runs = await makeDueRuns({ cutoff: MONDAY_MORNING });
    const order = buy();
    await saveOrder(owner, order);
    // The caller submits the same intent: the row keeps its owner, so the caller's run stays.
    await saveOrder(caller, order);
    const callerRun = runs.find((run) => run.userId === caller)!;
    expect((await runStatus(callerRun.id)).status).toBe("due");
  });

  it("a sell answers nothing", async () => {
    const user = await account();
    await createPlan(user, plan(), { now: WED });
    const [run] = await makeDueRuns({ cutoff: MONDAY_MORNING });
    await saveOrder(user, buy({ direction: "sell" }));
    expect((await runStatus(run.id)).status).toBe("due");
  });

  it("a limit buy counts its dollars only in a dollar stablecoin, and its fill then links the same run", async () => {
    const user = await account();
    await createPlan(user, plan({ orderType: "limit", dipPct: 5 }), { now: WED });
    const [run] = await makeDueRuns({ cutoff: MONDAY_MORNING, priceOf: () => 200, limitOn: () => true });
    // 50 of a token that is not a dollar: not $50.
    expect(await placeRunForLimitOrder(await limitBuy(user, "POL", "50000000000000000000", 18))).toBeNull();
    const intentTx = await limitBuy(user, "USDC", "50000000");
    expect(await placeRunForLimitOrder(intentTx)).toBe(run.id);
    expect(await placeRunForLimitOrder(intentTx)).toBeNull();
    const fillId = await saveOrder(user, buy({ intentTx }));
    expect(await runStatus(run.id)).toMatchObject({ status: "placed", order_id: fillId });
  });

  it("limitOrderDollars", () => {
    expect(limitOrderDollars("USDC", "25000000", 6)).toBe(25);
    expect(limitOrderDollars("ETH", "25000000", 6)).toBeNull();
    expect(limitOrderDollars(null, "25000000", 6)).toBeNull();
  });
});

describe("the morning, plan by plan", () => {
  it("stops cleanly at its deadline: what it did not reach is deferred, never half made", async () => {
    const user = await account();
    await createPlan(user, plan(), { now: WED });
    await createPlan(user, plan({ listing: "TSLA" }), { now: WED });
    let ticks = 0;
    // The clock passes the deadline after the first plan.
    const summary = await runRecurringMorning({ now: MONDAY_MORNING, deadline: 2, clock: () => ++ticks, remind: remindByEmail });
    expect(summary).toMatchObject({ made: 1, emailed: 1, deferred: 1 });
    // The deferred plan's date has not moved: the next pass makes its run.
    const later = await runRecurringMorning({ now: MONDAY_MORNING + 60_000, remind: remindByEmail });
    expect(later).toMatchObject({ made: 1, emailed: 1, deferred: 0 });
    expect(sent).toHaveLength(2);
  });

  it("after a long outage, a day past its three days moves the date on and makes no run", async () => {
    const user = await account();
    await createPlan(user, plan(), { now: WED });
    const summary = await runRecurringMorning({ now: MONDAY_START + 4 * DAY, remind: remindByEmail });
    expect(summary).toMatchObject({ made: 0, emailed: 0 });
    expect(sent).toHaveLength(0);
    const [listed] = await listPlans(user);
    expect(listed.nextDueAt).toBe("2026-10-11T22:00:00.000Z");
    expect(listed.runs).toEqual([]);
  });

  it("a reminder that failed the first morning is sent the next, for a zone whose day began before the cron", async () => {
    const user = await account();
    await createPlan(user, plan(), { now: WED });
    setEmailTransport(async () => ({ ok: false, error: "http_500" }));
    const first = await runRecurringMorning({ now: MONDAY_MORNING, remind: remindByEmail });
    expect(first).toMatchObject({ made: 1, emailed: 0, notEmailed: 1 });
    setEmailTransport(async (email) => {
      sent.push(email);
      return { ok: true, id: "re_test" };
    });
    // Amsterdam's Monday began at 22:00 UTC the day before: more than a day ago by the second morning.
    const second = await runRecurringMorning({ now: MONDAY_MORNING + DAY, remind: remindByEmail });
    expect(second).toMatchObject({ made: 0, emailed: 1 });
    expect(sent).toHaveLength(1);
  });

  it("a reminder that can never send is stamped final and not tried again", async () => {
    const user = await account(null);
    await createPlan(user, plan(), { now: WED });
    let tries = 0;
    const remind = async (run: Parameters<typeof remindByEmail>[0]) => {
      tries += 1;
      return remindByEmail(run);
    };
    await runRecurringMorning({ now: MONDAY_MORNING, remind });
    await runRecurringMorning({ now: MONDAY_MORNING + DAY, remind });
    expect(tries).toBe(1);
    expect(await sql.query(`select email_outcome from recurring_runs`)).toEqual([{ email_outcome: "final" }]);
  });

  it("reads prices only when a dip plan is due", async () => {
    const user = await account();
    await createPlan(user, plan(), { now: WED });
    let reads = 0;
    const priceOf = lazyPrices(async () => {
      reads += 1;
      return { NVDA: 200 };
    });
    await runRecurringMorning({ now: MONDAY_MORNING, priceOf, limitOn: () => true, remind: remindByEmail });
    expect(reads).toBe(0);
    await createPlan(user, plan({ listing: "TSLA", orderType: "limit", dipPct: 5 }), { now: WED });
    await createPlan(user, plan({ listing: "AAPL", orderType: "limit", dipPct: 5 }), { now: WED });
    await runRecurringMorning({ now: MONDAY_MORNING + 60_000, priceOf, limitOn: () => true, remind: remindByEmail });
    expect(reads).toBe(1);
  });
});

describe("the morning's one price read", () => {
  it("is not started without room for it: the dip plan waits, the others go on", async () => {
    const user = await account();
    await createPlan(user, plan({ orderType: "limit", dipPct: 5 }), { now: WED });
    await createPlan(user, plan({ listing: "TSLA" }), { now: WED });
    let reads = 0;
    const priceOf = lazyPrices(async () => {
      reads += 1;
      return { NVDA: 200 };
    });
    // Five seconds left before the deadline, a read may take ten.
    const tight = await runRecurringMorning({
      now: MONDAY_MORNING,
      deadline: 15_000,
      clock: () => 10_000,
      priceReadMs: 10_000,
      priceOf,
      limitOn: () => true,
      remind: remindByEmail,
    });
    expect(tight).toMatchObject({ made: 1, deferred: 1 });
    expect(reads).toBe(0);
    // The deferred plan's date has not moved: with room, the next pass reads once and makes its run.
    const roomy = await runRecurringMorning({
      now: MONDAY_MORNING + 60_000,
      deadline: 15_000,
      clock: () => 0,
      priceReadMs: 10_000,
      priceOf,
      limitOn: () => true,
      remind: remindByEmail,
    });
    expect(roomy).toMatchObject({ made: 1, deferred: 0 });
    expect(reads).toBe(1);
    expect((await readyRuns(user)).find((run) => run.symbol === "NVDA")).toMatchObject({ limitPrice: 190 });
  });

  it("once read, later dip plans answer from memory whatever time is left", async () => {
    const user = await account();
    await createPlan(user, plan({ orderType: "limit", dipPct: 5 }), { now: WED });
    await createPlan(user, plan({ listing: "TSLA", orderType: "limit", dipPct: 5 }), { now: WED });
    let ticks = 0;
    let reads = 0;
    const priceOf = lazyPrices(async () => {
      reads += 1;
      return { NVDA: 200, TSLA: 400 };
    });
    // Room for the first read only; the clock then jumps close to the deadline.
    const summary = await runRecurringMorning({
      now: MONDAY_MORNING,
      deadline: 15_000,
      clock: () => (ticks++ < 2 ? 0 : 12_000),
      priceReadMs: 10_000,
      priceOf,
      limitOn: () => true,
      remind: async () => "sent" as const,
    });
    expect(summary).toMatchObject({ made: 2, deferred: 0 });
    expect(reads).toBe(1);
  });

  it("an account without limit orders reads nothing, so nothing waits for room", async () => {
    const user = await account();
    await createPlan(user, plan({ orderType: "limit", dipPct: 5 }), { now: WED });
    const summary = await runRecurringMorning({
      now: MONDAY_MORNING,
      deadline: 15_000,
      clock: () => 10_000,
      priceReadMs: 10_000,
      priceOf: lazyPrices(async () => ({ NVDA: 200 })),
      limitOn: () => false,
      remind: remindByEmail,
    });
    expect(summary).toMatchObject({ made: 1, deferred: 0 });
  });
});

describe("a buy signed before its run was made", () => {
  it("answers the run as it is made, and no reminder goes", async () => {
    const user = await account();
    await createPlan(user, plan({ timeZone: "Asia/Tokyo" }), { now: WED });
    // Tokyo's Monday began at 15:00 UTC on Sunday; the person bought at 09:00 Monday, Tokyo time, before the morning run.
    const orderId = await saveOrder(user, buy({ placedAt: new Date("2026-10-05T00:00:00Z") }));
    const summary = await runRecurringMorning({ now: MONDAY_MORNING, remind: remindByEmail });
    expect(summary).toMatchObject({ made: 1, emailed: 0 });
    expect(sent).toHaveLength(0);
    const [listed] = await listPlans(user);
    expect(listed.runs[0].status).toBe("placed");
    expect(await sql.query(`select order_id from recurring_runs`)).toEqual([{ order_id: orderId }]);
  });

  it("a buy from before the day began, or of another amount, does not", async () => {
    const user = await account();
    await createPlan(user, plan({ timeZone: "Asia/Tokyo" }), { now: WED });
    await saveOrder(user, buy({ placedAt: new Date("2026-10-04T12:00:00Z") }));
    await saveOrder(user, buy({ placedAt: new Date("2026-10-05T00:00:00Z"), usdValue: "500" }));
    const summary = await runRecurringMorning({ now: MONDAY_MORNING, remind: remindByEmail });
    expect(summary).toMatchObject({ made: 1, emailed: 1 });
  });
});

describe("a dip plan with no price today", () => {
  it("drafts an ordinary buy, and the reminder and the strip say so", async () => {
    const user = await account();
    await createPlan(user, plan({ orderType: "limit", dipPct: 5 }), { now: WED });
    const summary = await runRecurringMorning({ now: MONDAY_MORNING, priceOf: () => undefined, limitOn: () => true, remind: remindByEmail });
    expect(summary).toMatchObject({ made: 1, emailed: 1 });
    expect(sent[0].text).toContain("could not set the dip you chose today");
    const [ready] = await readyRuns(user);
    expect(ready).toMatchObject({ orderType: "limit", limitPrice: null });
  });
});

async function claim(userId: string, at: number, { listing = "NVDA", direction = "buy" }: { listing?: string | null; direction?: string } = {}) {
  const intentTx = `0x${Math.random().toString(16).slice(2)}`;
  await sql.query(`insert into pour_claims (intent_tx, user_id, direction, listing_symbol, created_at) values ($1, $2, $3, $4, $5)`, [
    intentTx,
    userId,
    direction,
    listing,
    new Date(at).toISOString(),
  ]);
  return intentTx;
}

describe("a buy whose fill is not confirmed yet (an open pour claim)", () => {
  it("is not offered again, not reminded, and not let go until the evening pass confirms it", async () => {
    const user = await account();
    await createPlan(user, plan(), { now: WED });
    const [run] = await makeDueRuns({ cutoff: MONDAY_START + 60_000, userId: user });
    await claim(user, MONDAY_START + 120_000);
    // Neither the strip nor the email offers it a second time.
    expect(await readyRuns(user)).toEqual([]);
    const morning = await runRecurringMorning({ now: MONDAY_MORNING, remind: remindByEmail });
    expect(morning).toMatchObject({ made: 0, emailed: 0, notEmailed: 0 });
    expect(sent).toHaveLength(0);
    // Past its three days, a page load and the morning both leave it waiting.
    const late = MONDAY_START + 3 * DAY + 60_000;
    expect(await ageRuns(late, user)).toBe(0);
    expect((await runRecurringMorning({ now: late, remind: remindByEmail })).aged).toBe(0);
    expect((await runStatus(run.id)).status).toBe("due");
    // The evening pass records the order: the run is placed, not skipped.
    const orderId = await saveOrder(user, buy({ placedAt: new Date(MONDAY_START + 120_000) }));
    expect(await runStatus(run.id)).toMatchObject({ status: "placed", order_id: orderId });
  });

  it("a claim dropped unfilled gives the run back to the strip and the morning", async () => {
    const user = await account();
    await createPlan(user, plan(), { now: WED });
    await makeDueRuns({ cutoff: MONDAY_START + 60_000, userId: user });
    const intentTx = await claim(user, MONDAY_START + 120_000);
    expect(await readyRuns(user)).toEqual([]);
    await sql.query(`update pour_claims set settled_at = now(), outcome = 'dropped' where intent_tx = $1`, [intentTx]);
    expect(await readyRuns(user)).toHaveLength(1);
    expect(await runRecurringMorning({ now: MONDAY_MORNING, remind: remindByEmail })).toMatchObject({ emailed: 1 });
  });

  it("a run the morning makes while a claim waits sends no reminder, and one follows once the claim is dropped", async () => {
    const user = await account();
    await createPlan(user, plan(), { now: WED });
    const intentTx = await claim(user, MONDAY_START + 120_000);
    const first = await runRecurringMorning({ now: MONDAY_MORNING, remind: remindByEmail });
    expect(first).toMatchObject({ made: 1, emailed: 0, notEmailed: 0 });
    expect(sent).toHaveLength(0);
    await sql.query(`update pour_claims set settled_at = now(), outcome = 'dropped' where intent_tx = $1`, [intentTx]);
    const second = await runRecurringMorning({ now: MONDAY_MORNING + DAY, remind: remindByEmail });
    expect(second).toMatchObject({ made: 0, emailed: 1 });
  });

  it("holds back nothing for another listing, a sell, a claim from before the window, or one with no listing", async () => {
    const user = await account();
    await createPlan(user, plan(), { now: WED });
    await makeDueRuns({ cutoff: MONDAY_START + 60_000, userId: user });
    await claim(user, MONDAY_START + 120_000, { listing: "TSLA" });
    await claim(user, MONDAY_START + 120_000, { direction: "sell" });
    await claim(user, Date.parse("2026-09-01T00:00:00Z"));
    await claim(user, MONDAY_START + 120_000, { listing: null });
    expect(await readyRuns(user)).toHaveLength(1);
    expect(await ageRuns(MONDAY_START + 3 * DAY + 60_000, user)).toBe(1);
  });

  it("a newer run does not let an older one go while a claim waits on it", async () => {
    const user = await account();
    await createPlan(user, plan(), { now: WED });
    const [older] = await makeDueRuns({ cutoff: MONDAY_START + 60_000, userId: user });
    await claim(user, MONDAY_START + 120_000);
    // A week later the next run comes; the older one stays for its buy.
    await makeDueRuns({ cutoff: MONDAY_START + 7 * DAY + 3_600_000, userId: user });
    expect((await runStatus(older.id)).status).toBe("due");
  });
});

describe("the schema", () => {
  it("replaces an older check on email_prefs.kind whatever its name, and takes the recurring switch", async () => {
    await sql.query(`alter table email_prefs drop constraint if exists email_prefs_kind_check`);
    await sql.query(`alter table email_prefs add constraint email_prefs_kind_old check (kind in ('orders', 'friends', 'weekly'))`);
    const { readFileSync } = await import("node:fs");
    const schema = readFileSync(`${process.cwd()}/db/schema.sql`, "utf8");
    const start = schema.indexOf("-- The recurring reminder's own switch");
    for (const statement of schema.slice(start).split(/;\s*\n/).map((part) => part.trim()).filter(Boolean)) {
      await sql.query(statement);
    }
    const checks = (await sql.query(
      `select conname from pg_constraint where conrelid = 'email_prefs'::regclass and contype = 'c' order by conname`,
    )) as { conname: string }[];
    expect(checks.map((check) => check.conname)).toEqual(["email_prefs_kind_check"]);
    const user = await account();
    await setPref(user, "recurring", false);
  });
});
