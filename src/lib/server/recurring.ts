import { getSql } from "@/lib/server/db";
import { formatUsd } from "@/lib/format";
import { TOKEN_LISTINGS } from "@/lib/listings";
import { isDollarStable } from "@/lib/orders";
import {
  MAX_PLANS,
  RECURRING_ID,
  SKIP_AFTER_DAYS,
  WEEKDAY_NAMES,
  dipExpiry,
  dipPrice,
  dueAfter,
  firstDueAt,
  nextRunStatus,
  orderMatchesRun,
  runDraftUrl,
  MORNING_LOOKAHEAD_HOURS,
  type CheckedPlan,
  type PlanSchedule,
  type PlanView,
  type ReadyRun,
  type RunStatus,
  type RunView,
} from "@/lib/recurring";

/**
 * Recurring buys on the server (docs/adr/0007, lib/recurring for the
 * rules): the plans and their runs, in recurring_plans and recurring_runs.
 * Berth reminds, the person signs. Nothing here quotes, reserves or signs
 * an order: a run is a reminder with a draft link, marked placed only when
 * an order the person signed is recorded (the pour route, a limit order's
 * record) for that listing and about that amount inside the run's window.
 * A run keeps the listing and dollars the plan had when it was made, so an
 * edit never changes what a waiting run asks for or what answers it.
 */

type PlanRow = {
  id: string;
  user_id: string;
  listing_symbol: string;
  usd: string | number;
  cadence: "weekly" | "monthly";
  weekday: number | null;
  month_day: number | null;
  time_zone: string;
  order_type: "market" | "limit";
  dip_pct: string | number | null;
  paused: boolean;
  created_via: "app" | "assistant";
  next_due_at: string | Date;
};

type RunRow = {
  id: string;
  plan_id: string;
  due_at: string | Date;
  status: RunStatus;
  limit_price: string | number | null;
  created_at: string | Date;
};

const ms = (value: string | Date) => new Date(value).getTime();
const num = (value: string | number | null) => (value === null ? null : Number(value));

export function scheduleOf(row: Pick<PlanRow, "cadence" | "weekday" | "month_day" | "time_zone">): PlanSchedule {
  return { cadence: row.cadence, weekday: row.weekday, monthDay: row.month_day, timeZone: row.time_zone };
}

function runView(row: RunRow): RunView {
  return { id: row.id, planId: row.plan_id, dueAt: new Date(row.due_at).toISOString(), status: row.status, limitPrice: num(row.limit_price) };
}

function planView(row: PlanRow, runs: RunView[]): PlanView {
  return {
    id: row.id,
    symbol: row.listing_symbol,
    usd: Number(row.usd),
    cadence: row.cadence,
    weekday: row.weekday,
    monthDay: row.month_day,
    timeZone: row.time_zone,
    orderType: row.order_type,
    dipPct: num(row.dip_pct),
    paused: row.paused,
    nextDueAt: new Date(row.next_due_at).toISOString(),
    createdVia: row.created_via,
    runs,
  };
}

const PLAN_COLUMNS = `id, user_id, listing_symbol, usd, cadence, weekday, month_day, time_zone, order_type, dip_pct, paused, created_via, next_due_at`;

/** Every plan of the account, oldest first, each with its last four runs. */
export async function listPlans(userId: string): Promise<PlanView[]> {
  const sql = getSql();
  const plans = (await sql.query(`select ${PLAN_COLUMNS} from recurring_plans where user_id = $1 order by created_at, id`, [userId])) as PlanRow[];
  if (plans.length === 0) return [];
  const runs = (await sql.query(
    `select id, plan_id, due_at, status, limit_price, created_at from (
       select r.*, row_number() over (partition by plan_id order by due_at desc) as n
         from recurring_runs r where user_id = $1) ranked
      where n <= 4 order by due_at desc`,
    [userId],
  )) as RunRow[];
  return plans.map((plan) => planView(plan, runs.filter((run) => run.plan_id === plan.id).map(runView)));
}

export type PlanWrite = Extract<CheckedPlan, { ok: true }>["plan"];

const isCapRefusal = (error: unknown) =>
  (error as { code?: unknown })?.code === "23514" && /recurring plans cap/.test(error instanceof Error ? error.message : String(error));

/**
 * A new plan, first due on the next day it names. Refused past MAX_PLANS:
 * by the statement itself, and, for two creates at once, by the cap
 * trigger on recurring_plans (db/schema.sql recurring_plans_cap).
 */
export async function createPlan(
  userId: string,
  plan: PlanWrite,
  { via = "app", now = Date.now() }: { via?: "app" | "assistant"; now?: number } = {},
): Promise<PlanView | "too_many"> {
  const next = new Date(firstDueAt(plan.schedule, now)).toISOString();
  const rows = (await getSql().query(
    `insert into recurring_plans (user_id, listing_symbol, usd, cadence, weekday, month_day, time_zone, order_type, dip_pct, created_via, next_due_at)
     select $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
      where (select count(*) from recurring_plans where user_id = $1) < $12
     returning ${PLAN_COLUMNS}`,
    [
      userId,
      plan.symbol,
      plan.usd,
      plan.schedule.cadence,
      plan.schedule.weekday,
      plan.schedule.monthDay,
      plan.schedule.timeZone,
      plan.orderType,
      plan.dipPct,
      via,
      next,
      MAX_PLANS,
    ],
  ).catch((error: unknown) => {
    if (isCapRefusal(error)) return [];
    throw error;
  })) as PlanRow[];
  return rows[0] ? planView(rows[0], []) : "too_many";
}

async function ownPlan(userId: string, planId: string): Promise<PlanRow | null> {
  if (!RECURRING_ID.test(planId)) return null;
  const rows = (await getSql().query(`select ${PLAN_COLUMNS} from recurring_plans where id = $1 and user_id = $2`, [planId, userId])) as PlanRow[];
  return rows[0] ?? null;
}

/** An edit: a new amount keeps the next date; a new day (or zone) starts from the next day it names. */
export async function updatePlan(userId: string, planId: string, plan: PlanWrite, now = Date.now()): Promise<PlanView | null> {
  const current = await ownPlan(userId, planId);
  if (!current) return null;
  const was = scheduleOf(current);
  const moved =
    was.cadence !== plan.schedule.cadence ||
    was.weekday !== plan.schedule.weekday ||
    was.monthDay !== plan.schedule.monthDay ||
    was.timeZone !== plan.schedule.timeZone;
  const next = moved ? new Date(firstDueAt(plan.schedule, now)).toISOString() : new Date(current.next_due_at).toISOString();
  const rows = (await getSql().query(
    `update recurring_plans set listing_symbol = $3, usd = $4, cadence = $5, weekday = $6, month_day = $7, time_zone = $8,
            order_type = $9, dip_pct = $10, next_due_at = $11, updated_at = now()
      where id = $1 and user_id = $2
      returning ${PLAN_COLUMNS}`,
    [planId, userId, plan.symbol, plan.usd, plan.schedule.cadence, plan.schedule.weekday, plan.schedule.monthDay, plan.schedule.timeZone, plan.orderType, plan.dipPct, next],
  )) as PlanRow[];
  return rows[0] ? planView(rows[0], []) : null;
}

/** Pause, or resume: a plan resumed after its date has passed starts from the next day it names, never with a backlog. */
export async function setPaused(userId: string, planId: string, paused: boolean, now = Date.now()): Promise<PlanView | null> {
  const current = await ownPlan(userId, planId);
  if (!current) return null;
  const next =
    !paused && ms(current.next_due_at) <= now
      ? new Date(firstDueAt(scheduleOf(current), now)).toISOString()
      : new Date(current.next_due_at).toISOString();
  const sql = getSql();
  const rows = (await sql.query(
    `update recurring_plans set paused = $3, next_due_at = $4, updated_at = now() where id = $1 and user_id = $2 returning ${PLAN_COLUMNS}`,
    [planId, userId, paused, next],
  )) as PlanRow[];
  // A paused plan's waiting run goes quietly: nothing is left asking.
  if (paused) {
    await sql.query(
      `update recurring_runs set status = 'skipped', closed_at = now() where plan_id = $1 and status in ('due', 'opened')`,
      [planId],
    );
  }
  return rows[0] ? planView(rows[0], []) : null;
}

export async function deletePlan(userId: string, planId: string): Promise<boolean> {
  if (!RECURRING_ID.test(planId)) return false;
  const rows = (await getSql().query(`delete from recurring_plans where id = $1 and user_id = $2 returning id`, [planId, userId])) as unknown[];
  return rows.length > 0;
}

/** Runs past their three days, skipped. Answers how many. */
export async function ageRuns(now = Date.now(), userId?: string): Promise<number> {
  const cutoff = new Date(now - SKIP_AFTER_DAYS * 86_400_000).toISOString();
  const rows = (await getSql().query(
    `update recurring_runs set status = 'skipped', closed_at = now()
      where status in ('due', 'opened') and due_at <= $1 ${userId ? "and user_id = $2" : ""}
      returning id`,
    userId ? [cutoff, userId] : [cutoff],
  )) as unknown[];
  return rows.length;
}

export type NewRun = {
  id: string;
  userId: string;
  symbol: string;
  usd: number;
  dueAt: number;
  schedule: PlanSchedule;
  limitPrice: number | null;
  /** The last day a dip order waits, for the draft link. */
  expires?: string;
  /** A dip plan with no price today (none read, or limit orders off): an ordinary buy, and the reminder says so. */
  dipUnpriced?: true;
  /** Already answered when it was made: a buy signed earlier that day. No reminder. */
  placed?: true;
};

type DuePlan = PlanRow & { wallet_address: string | null };

/** A symbol's live price, read only when a dip plan is actually due. */
export type PriceReader = (symbol: string) => number | undefined | Promise<number | undefined>;

async function duePlans(cutoff: number, userId?: string): Promise<DuePlan[]> {
  return (await getSql().query(
    `select ${PLAN_COLUMNS.split(", ").map((column) => `p.${column}`).join(", ")}, u.wallet_address
       from recurring_plans p join users u on u.id = p.user_id
      where not p.paused and p.next_due_at <= $1 ${userId ? "and p.user_id = $2" : ""}
      order by p.next_due_at limit 500`,
    userId ? [new Date(cutoff).toISOString(), userId] : [new Date(cutoff).toISOString()],
  )) as DuePlan[];
}

/**
 * One plan whose day has come (by `cutoff`): its run, or null when another
 * caller made it first. A plan that missed several days (a paused cron, a
 * long outage) gets only its latest. Moving the plan's next date (a
 * compare and set, so the morning run and a page load at the same moment
 * make one run, not two), letting its older waiting run go, and inserting
 * the new run are one statement: there is never a moved date without its
 * run. A day more than SKIP_AFTER_DAYS gone still moves the date, but
 * makes no run and sends nothing: a reminder nobody could answer.
 */
async function makeRun(
  plan: DuePlan,
  {
    cutoff,
    now,
    priceOf,
    limitOn,
  }: { cutoff: number; now: number; priceOf: PriceReader; limitOn: (user: { id: string; wallet: string | null }) => boolean },
): Promise<NewRun | null> {
  const schedule = scheduleOf(plan);
  let dueAt = ms(plan.next_due_at);
  let next = dueAfter(schedule, dueAt);
  // Only the latest missed day.
  for (let guard = 0; next <= cutoff && guard < 400; guard += 1) {
    dueAt = next;
    next = dueAfter(schedule, next);
  }
  const expired = dueAt + SKIP_AFTER_DAYS * 86_400_000 <= now;
  const limit =
    !expired && plan.order_type === "limit" && limitOn({ id: plan.user_id, wallet: plan.wallet_address })
      ? dipPrice(await priceOf(plan.listing_symbol), num(plan.dip_pct))
      : null;
  const rows = (await getSql().query(
    `with moved as (
       update recurring_plans set next_due_at = $3 where id = $1 and next_due_at = $2 and not paused
       returning id, user_id, listing_symbol, usd, order_type
     ), let_go as (
       update recurring_runs set status = 'skipped', closed_at = now()
        where plan_id in (select id from moved) and status in ('due', 'opened') and due_at < $4
     ), made as (
       insert into recurring_runs (plan_id, user_id, due_at, limit_price, listing_symbol, usd, order_type)
       select id, user_id, $4, $5, listing_symbol, usd, order_type from moved where not $6::boolean
       on conflict on constraint recurring_runs_plan_due do nothing
       returning id
     )
     select (select id from made) as id`,
    [plan.id, new Date(plan.next_due_at).toISOString(), new Date(next).toISOString(), new Date(dueAt).toISOString(), limit, expired],
  )) as { id: string | null }[];
  const id = rows[0]?.id;
  if (!id) return null;
  // A buy already signed since the day began (the person bought before the morning run reached this run) answers it now.
  const placed = dueAt <= now && (await answerFromEarlierBuy({ runId: id, userId: plan.user_id, symbol: plan.listing_symbol, dueAt, now }));
  return {
    id,
    ...(placed && { placed: true as const }),
    ...(plan.order_type === "limit" && limit === null && { dipUnpriced: true as const }),
    userId: plan.user_id,
    symbol: plan.listing_symbol,
    usd: Number(plan.usd),
    dueAt,
    schedule,
    limitPrice: limit,
    ...(limit !== null && { expires: dipExpiry(schedule, dueAt) }),
  };
}

/**
 * A run just made, looking back: the first buy of its listing the account
 * signed between the run's due time and now, not already answering a run,
 * that matches it (an order, or a limit buy paid in a dollar stablecoin).
 */
async function answerFromEarlierBuy({
  runId,
  userId,
  symbol,
  dueAt,
  now,
}: {
  runId: string;
  userId: string;
  symbol: string;
  dueAt: number;
  now: number;
}): Promise<boolean> {
  try {
    const sql = getSql();
    const window = [userId, symbol, new Date(dueAt).toISOString(), new Date(now).toISOString()];
    const orders = (await sql.query(
      `select o.id, o.usd_value, coalesce(o.placed_at, o.created_at) as at, l.id as limit_id
         from orders o left join limit_orders l on l.intent_tx = o.intent_tx
        where o.user_id = $1 and o.direction = 'buy' and upper(o.listing_symbol) = upper($2)
          and coalesce(o.placed_at, o.created_at) >= $3 and coalesce(o.placed_at, o.created_at) <= $4
          and not exists (select 1 from recurring_runs r where r.order_id = o.id)
        order by at limit 20`,
      window,
    )) as { id: string; usd_value: string | null; at: string | Date; limit_id: string | null }[];
    for (const order of orders) {
      const placed = await placeMatchingRun({
        userId,
        symbol,
        usd: order.usd_value === null ? null : Number(order.usd_value),
        at: ms(order.at),
        orderId: order.id,
        limitOrderId: order.limit_id,
        runId,
      });
      if (placed) return true;
    }
    const limits = (await sql.query(
      `select l.id, l.pay_symbol, l.input_raw::text as input_raw, l.input_decimals, l.placed_at
         from limit_orders l
        where l.user_id = $1 and l.direction = 'buy' and upper(l.listing_symbol) = upper($2)
          and l.placed_at >= $3 and l.placed_at <= $4
          and not exists (select 1 from recurring_runs r where r.limit_order_id = l.id)
        order by l.placed_at limit 20`,
      window,
    )) as { id: string; pay_symbol: string | null; input_raw: string; input_decimals: number; placed_at: string | Date }[];
    for (const limit of limits) {
      const placed = await placeMatchingRun({
        userId,
        symbol,
        usd: limitOrderDollars(limit.pay_symbol, limit.input_raw, limit.input_decimals),
        at: ms(limit.placed_at),
        limitOrderId: limit.id,
        runId,
      });
      if (placed) return true;
    }
    return false;
  } catch (error) {
    console.warn("[recurring] earlier buy not read", error instanceof Error ? error.message : error);
    return false;
  }
}

/**
 * Makes the run for every plan whose day has come (by `cutoff`), one per
 * plan (makeRun). `limitOn` says whether the account may still have a dip
 * draft; without it, or without a live price, the run is an ordinary buy.
 * Prices are read only for a dip plan that is due.
 */
export async function makeDueRuns({
  cutoff,
  now = cutoff,
  userId,
  priceOf = () => undefined,
  limitOn = () => false,
}: {
  cutoff: number;
  now?: number;
  userId?: string;
  priceOf?: PriceReader;
  limitOn?: (user: { id: string; wallet: string | null }) => boolean;
}): Promise<NewRun[]> {
  const made: NewRun[] = [];
  for (const plan of await duePlans(cutoff, userId)) {
    const run = await makeRun(plan, { cutoff, now, priceOf, limitOn });
    if (run) made.push(run);
  }
  return made;
}

/** The runs waiting for the person, oldest first: what the strip shows. */
export async function readyRuns(userId: string): Promise<ReadyRun[]> {
  const rows = (await getSql().query(
    `select r.id, r.plan_id, r.due_at, r.status, r.limit_price, r.created_at, r.listing_symbol, r.usd, r.order_type, p.cadence, p.time_zone
       from recurring_runs r join recurring_plans p on p.id = r.plan_id
      where r.user_id = $1 and r.status in ('due', 'opened') and not p.paused
      order by r.due_at`,
    [userId],
  )) as (RunRow & { listing_symbol: string; usd: string; order_type: "market" | "limit"; cadence: "weekly" | "monthly"; time_zone: string })[];
  return rows.map((row) => ({
    ...runView(row),
    symbol: row.listing_symbol,
    usd: Number(row.usd),
    orderType: row.order_type,
    cadence: row.cadence,
    timeZone: row.time_zone,
  }));
}

async function moveRun(userId: string, runId: string, event: "open" | "skip", now: number): Promise<RunStatus | null> {
  if (!RECURRING_ID.test(runId)) return null;
  const sql = getSql();
  const rows = (await sql.query(`select status, due_at from recurring_runs where id = $1 and user_id = $2`, [runId, userId])) as {
    status: RunStatus;
    due_at: string | Date;
  }[];
  const row = rows[0];
  if (!row) return null;
  const next = nextRunStatus(row.status, event, ms(row.due_at), now);
  if (!next) return row.status;
  await sql.query(
    `update recurring_runs set status = $3,
            opened_at = case when $3 = 'opened' then now() else opened_at end,
            closed_at = case when $3 = 'skipped' then now() else closed_at end
      where id = $1 and user_id = $2 and status = $4`,
    [runId, userId, next, row.status],
  );
  return next;
}

/** The person opened the run's draft (the strip, or the email's link). */
export const openRun = (userId: string, runId: string, now = Date.now()) => moveRun(userId, runId, "open", now);
/** The person let this one pass. It costs nothing. */
export const skipRun = (userId: string, runId: string, now = Date.now()) => moveRun(userId, runId, "skip", now);

/**
 * An order the person signed: the oldest waiting run it answers (same
 * listing, about the same dollars, inside the window) becomes placed and
 * links it. Idempotent: an order or a limit order already linked to a run
 * answers nothing more (checked here, and by the unique indexes on
 * recurring_runs), so a replay of the same intent never closes a second
 * run. Callers pass the owner of the row as recorded, never the caller's
 * word (placeRunForOrder, placeRunForLimitOrder). Never throws.
 */
export async function placeMatchingRun(order: {
  userId: string;
  symbol: string;
  usd: number | null;
  at: number;
  orderId?: string | null;
  limitOrderId?: string | null;
  /** Only this run (a run just made, looking back for a buy already signed). */
  runId?: string;
}): Promise<string | null> {
  try {
    const sql = getSql();
    const orderId = order.orderId ?? null;
    const limitOrderId = order.limitOrderId ?? null;
    if (orderId || limitOrderId) {
      const linked = (await sql.query(
        `select id from recurring_runs where ($1::uuid is not null and order_id = $1) or ($2::uuid is not null and limit_order_id = $2) limit 1`,
        [orderId, limitOrderId],
      )) as { id: string }[];
      if (linked[0]) return null;
    }
    const rows = (await sql.query(
      `select r.id, r.due_at, r.created_at, r.listing_symbol, r.usd
         from recurring_runs r
        where r.user_id = $1 and r.status in ('due', 'opened') and upper(r.listing_symbol) = upper($2)
          and ($3::uuid is null or r.id = $3)
        order by r.due_at`,
      [order.userId, order.symbol, order.runId ?? null],
    )) as { id: string; due_at: string | Date; created_at: string | Date; listing_symbol: string; usd: string }[];
    const match = rows.find((row) =>
      orderMatchesRun(
        { symbol: row.listing_symbol, usd: Number(row.usd), dueAt: ms(row.due_at), createdAt: ms(row.created_at) },
        { symbol: order.symbol, usd: order.usd, at: order.at },
      ),
    );
    if (!match) return null;
    const placed = (await sql.query(
      `update recurring_runs set status = 'placed', closed_at = now(), order_id = coalesce($2, order_id), limit_order_id = coalesce($3, limit_order_id)
        where id = $1 and user_id = $4 and status in ('due', 'opened')
          and not exists (select 1 from recurring_runs other
                           where ($2::uuid is not null and other.order_id = $2) or ($3::uuid is not null and other.limit_order_id = $3))
        returning id`,
      [match.id, orderId, limitOrderId, order.userId],
    )) as { id: string }[];
    return placed[0]?.id ?? null;
  } catch (error) {
    console.warn("[recurring] run not matched", error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * A buy just written to `orders` (lib/server/orders saveOrder: the pour
 * route, the evening pass over pour claims, a limit order's fill; and
 * orders-recover): its run, if it answers one. The owner is the row's own
 * user_id, so an intent someone else recorded first answers only their
 * runs. A limit order's fill whose placement already answered a run links
 * the fill to that run and answers nothing more. Never throws.
 */
export async function placeRunForOrder(orderId: string): Promise<string | null> {
  try {
    const sql = getSql();
    const rows = (await sql.query(
      `select o.id, o.user_id, o.direction, o.listing_symbol, o.usd_value, coalesce(o.placed_at, o.created_at) as at, l.id as limit_id
         from orders o left join limit_orders l on l.intent_tx = o.intent_tx
        where o.id = $1`,
      [orderId],
    )) as { id: string; user_id: string | null; direction: string; listing_symbol: string; usd_value: string | null; at: string | Date; limit_id: string | null }[];
    const row = rows[0];
    if (!row || !row.user_id || row.direction !== "buy") return null;
    if (row.limit_id) {
      const linked = (await sql.query(
        `update recurring_runs set order_id = coalesce(order_id, $2)
          where limit_order_id = $1 and not exists (select 1 from recurring_runs other where other.order_id = $2)
          returning id`,
        [row.limit_id, row.id],
      )) as { id: string }[];
      if (linked[0]) return null;
      const answered = (await sql.query(`select 1 from recurring_runs where limit_order_id = $1`, [row.limit_id])) as unknown[];
      if (answered.length > 0) return null;
    }
    return placeMatchingRun({
      userId: row.user_id,
      symbol: row.listing_symbol,
      usd: row.usd_value === null ? null : Number(row.usd_value),
      at: ms(row.at),
      orderId: row.id,
      limitOrderId: row.limit_id,
    });
  } catch (error) {
    console.warn("[recurring] order not matched", error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * A limit buy just recorded (lib/server/limit-orders saveVerifiedIntent):
 * a dip plan's run, or any run it answers. Its dollars count only when it
 * is paid in a dollar stablecoin; paid in anything else the placement
 * answers nothing, and its fill, priced when it lands in `orders`, may.
 * The owner is the row's own user_id. Never throws.
 */
export async function placeRunForLimitOrder(intentTx: string): Promise<string | null> {
  try {
    const rows = (await getSql().query(
      `select id, user_id, direction, listing_symbol, pay_symbol, input_raw::text as input_raw, input_decimals, placed_at
         from limit_orders where intent_tx = $1`,
      [intentTx.toLowerCase()],
    )) as { id: string; user_id: string; direction: string; listing_symbol: string; pay_symbol: string | null; input_raw: string; input_decimals: number; placed_at: string | Date }[];
    const row = rows[0];
    if (!row || row.direction !== "buy") return null;
    return placeMatchingRun({
      userId: row.user_id,
      symbol: row.listing_symbol,
      usd: limitOrderDollars(row.pay_symbol, row.input_raw, row.input_decimals),
      at: ms(row.placed_at),
      limitOrderId: row.id,
    });
  } catch (error) {
    console.warn("[recurring] limit order not matched", error instanceof Error ? error.message : error);
    return null;
  }
}

/** A limit buy's dollars: its pay amount when that is a dollar stablecoin, otherwise unknown. */
export function limitOrderDollars(paySymbol: string | null, inputRaw: string, inputDecimals: number): number | null {
  if (!paySymbol || !isDollarStable(paySymbol)) return null;
  const amount = Number(inputRaw) / 10 ** inputDecimals;
  return Number.isFinite(amount) ? amount : null;
}

/** "Monday" for a weekly plan, "monthly" for a monthly one: how the strip and the email lead. */
export function planLead(schedule: Pick<PlanSchedule, "cadence" | "weekday">): string {
  return schedule.cadence === "weekly" ? WEEKDAY_NAMES[schedule.weekday ?? 1] : "monthly";
}

export const nameOfSymbol = (symbol: string) => TOKEN_LISTINGS.find((listing) => listing.symbol === symbol)?.name ?? symbol;

/** The reminder email's notice for a new run (lib/server/email compose, recurring_due). */
export function reminderNotice(run: NewRun, origin: string) {
  const url = new URL(runDraftUrl(origin, { id: run.id, symbol: run.symbol, usd: run.usd, limitPrice: run.limitPrice, expires: run.expires }));
  return {
    type: "recurring_due" as const,
    lead: planLead(run.schedule),
    name: nameOfSymbol(run.symbol),
    usd: formatUsd(run.usd),
    limitPrice: run.limitPrice !== null ? formatUsd(run.limitPrice) : null,
    dipUnpriced: run.dipUnpriced === true,
    path: `${url.pathname}${url.search}`,
  };
}

/**
 * Runs still waiting whose reminder has not reached a final outcome, over
 * the run's whole life (SKIP_AFTER_DAYS): made by a page load before the
 * morning run got to them, or tried before and deferred (the day's cap, a
 * provider error, the stage's deadline). Still due, never opened, so the
 * person has not seen them yet in any real sense. email_sends dedupes by
 * the run's id, so a retry never sends twice.
 */
export async function unemailedRuns(now: number, cutoff: number): Promise<NewRun[]> {
  const rows = (await getSql().query(
    `select r.id, r.user_id, r.due_at, r.limit_price, r.listing_symbol, r.usd, r.order_type, p.cadence, p.weekday, p.month_day, p.time_zone
       from recurring_runs r join recurring_plans p on p.id = r.plan_id
      where r.status = 'due' and r.emailed_at is null and r.email_outcome is null and not p.paused
        and r.due_at > $1 and r.due_at <= $2
      order by r.due_at limit 500`,
    [new Date(now - SKIP_AFTER_DAYS * 86_400_000).toISOString(), new Date(cutoff).toISOString()],
  )) as (Pick<PlanRow, "listing_symbol" | "usd" | "cadence" | "weekday" | "month_day" | "time_zone"> & {
    id: string;
    user_id: string;
    due_at: string | Date;
    limit_price: string | number | null;
    order_type: "market" | "limit";
  })[];
  return rows.map((row) => {
    const schedule = scheduleOf(row);
    const limitPrice = num(row.limit_price);
    return {
      id: row.id,
      userId: row.user_id,
      symbol: row.listing_symbol,
      usd: Number(row.usd),
      dueAt: ms(row.due_at),
      schedule,
      limitPrice,
      ...(limitPrice !== null && { expires: dipExpiry(schedule, ms(row.due_at)) }),
      ...(row.order_type === "limit" && limitPrice === null && { dipUnpriced: true as const }),
    };
  });
}

/**
 * What became of a run's reminder: sent; final (the switch is off, no
 * address, suppressed, already claimed), so it is never tried again; or
 * retry (the day's cap, a provider error, sending off), left open for the
 * next morning within the run's life.
 */
export type RemindOutcome = "sent" | "final" | "retry";

export async function markEmailOutcome(runId: string, outcome: Exclude<RemindOutcome, "retry">): Promise<void> {
  await getSql().query(
    `update recurring_runs set email_outcome = $2, emailed_at = case when $2 = 'sent' then now() else emailed_at end where id = $1`,
    [runId, outcome],
  );
}

export type RecurringMorningSummary = { aged: number; made: number; emailed: number; notEmailed: number; deferred: number };

/**
 * The morning run's recurring stage: age the old runs, then plan by plan
 * make today's run (every day that starts within MORNING_LOOKAHEAD_HOURS)
 * and send its one reminder at once, then retry the reminders still open.
 * Before each plan and each email it checks `deadline` and stops cleanly:
 * what it did not reach is counted as deferred and waits for a page load
 * or the next morning, never half made. The email is deduped by the run's
 * id in email_sends and goes through the person's switch, the address
 * check and the daily cap like every notice (lib/server/email/send).
 */
export async function runRecurringMorning({
  now = Date.now(),
  deadline = Number.POSITIVE_INFINITY,
  clock = Date.now,
  priceOf,
  limitOn,
  remind,
}: {
  now?: number;
  deadline?: number;
  clock?: () => number;
  priceOf?: PriceReader;
  limitOn?: (user: { id: string; wallet: string | null }) => boolean;
  remind: (run: NewRun) => Promise<RemindOutcome>;
}): Promise<RecurringMorningSummary> {
  const aged = await ageRuns(now);
  const cutoff = now + MORNING_LOOKAHEAD_HOURS * 3_600_000;
  const summary: RecurringMorningSummary = { aged, made: 0, emailed: 0, notEmailed: 0, deferred: 0 };
  const send = async (run: NewRun) => {
    let outcome: RemindOutcome = "retry";
    try {
      outcome = await remind(run);
    } catch (error) {
      console.warn("[recurring] reminder failed", error instanceof Error ? error.name : "error");
    }
    if (outcome === "sent") summary.emailed += 1;
    else summary.notEmailed += 1;
    if (outcome !== "retry") await markEmailOutcome(run.id, outcome).catch(() => undefined);
  };
  const seen = new Set<string>();
  const plans = await duePlans(cutoff);
  for (const [index, plan] of plans.entries()) {
    if (clock() >= deadline) {
      summary.deferred += plans.length - index;
      return summary;
    }
    const run = await makeRun(plan, { cutoff, now, priceOf: priceOf ?? (() => undefined), limitOn: limitOn ?? (() => false) });
    if (!run) continue;
    summary.made += 1;
    seen.add(run.id);
    if (!run.placed) await send(run);
  }
  // And any a page load made first, or tried before and left open: one email per run, whoever made it.
  const open = (await unemailedRuns(now, cutoff)).filter((run) => !seen.has(run.id));
  for (const [index, run] of open.entries()) {
    if (clock() >= deadline) {
      summary.deferred += open.length - index;
      break;
    }
    await send(run);
  }
  return summary;
}
