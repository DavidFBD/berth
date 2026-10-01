import { getSql } from "@/lib/server/db";
import { FIRST_BUY_PER_ACCOUNT_SQL, FIRST_BUYS_SQL } from "@/lib/first-buys";

/**
 * The staff Overview's numbers (app/staff/page), each one statement over
 * the ledger, counts and sums only: no row here names a person. Retired
 * accounts (merged into another) are left out everywhere, since the
 * survivor carries their orders.
 *
 * Definitions the page states beside the numbers:
 *
 * - Stage, as the server can tell it (lib/home-stage decides the real one
 *   in the browser, from the person's own wallets, which Berth never
 *   stores): `owns` holds a stock or fund in its latest stored day (or, with
 *   no stored day, by its orders); `funded` has money with Berth but no
 *   stock, which is Cash or an earlier order; `none` is everyone else.
 *   Money sitting in a person's own wallet shows up here as `none`.
 * - Active: the account opened Berth signed in (users.last_seen_at, the
 *   profile sync, from this release on), or placed an order, or used the
 *   Assistant or an AI connection, in the window. An XP award is not a
 *   visit and does not count.
 * - Volume is the orders' dollar value where known (usd_value). Fee
 *   revenue is the recorded fee (fee_amount, in the paying token, priced at
 *   the order's own dollar rate) where both are known, else 0.4% of the
 *   order's value: an estimate, not what reached the fee wallet.
 */

/** Berth's partner fee, for the revenue estimate only (the real fee is taken by the SDK, lib/pour-amount). */
export const FEE_RATE_ESTIMATE = 0.004;

/** Accounts that count: not merged into another. */
const LIVE = `select id, created_at, updated_at from users where retired_into is null`;

export type DayCount = { day: string; n: number };

/** Signups per UTC day for the last `days` days, today included, zero days kept. */
export async function signupsPerDay(days = 30): Promise<DayCount[]> {
  const rows = (await getSql().query(
    `select to_char(d, 'YYYY-MM-DD') as day, count(u.id)::int as n
       from generate_series((now() at time zone 'UTC')::date - ($1::int - 1), (now() at time zone 'UTC')::date, interval '1 day') d
       left join (${LIVE}) u on (u.created_at at time zone 'UTC')::date = d::date
      group by d order by d`,
    [days],
  )) as DayCount[];
  return rows.map((row) => ({ day: row.day, n: Number(row.n) }));
}

/** Signups per ISO week (Monday, UTC) for the last `weeks` weeks, this one included. */
export async function signupsPerWeek(weeks = 12): Promise<DayCount[]> {
  const rows = (await getSql().query(
    `select to_char(w, 'YYYY-MM-DD') as day, count(u.id)::int as n
       from generate_series(date_trunc('week', now() at time zone 'UTC') - make_interval(weeks => $1::int - 1), date_trunc('week', now() at time zone 'UTC'), interval '1 week') w
       left join (${LIVE}) u on date_trunc('week', u.created_at at time zone 'UTC') = w
      group by w order by w`,
    [weeks],
  )) as DayCount[];
  return rows.map((row) => ({ day: row.day, n: Number(row.n) }));
}

export type StageName = "none" | "funded" | "owns";

/**
 * The stage of one account `alias` (a users row in the query), as a
 * LATERAL join adding the column `st.stage` (see the module note). Per
 * row, through the indexes (portfolio_days' key, orders_user_idx), so a
 * page of fifty pays for fifty.
 */
export function stageLateral(alias: string): string {
  return `left join lateral (
    select case
      when lp.has_stock then 'owns'
      when lp.user_id is null and exists (
        select 1 from orders o where o.user_id = ${alias}.id and o.quantity is not null and o.listing_symbol <> 'SGOV'
         group by o.listing_symbol having sum(case when o.direction = 'buy' then o.quantity else -o.quantity end) > 0) then 'owns'
      when coalesce(lp.value_usd, 0) > 0 or exists (select 1 from orders o where o.user_id = ${alias}.id) then 'funded'
      else 'none'
    end as stage
    from (select 1) one
    left join lateral (
      select p.user_id, p.value_usd,
             exists (select 1 from jsonb_array_elements(p.holdings) h
                      where h->>'symbol' <> 'SGOV' and coalesce((h->>'quantity')::numeric, 0) > 0) as has_stock
        from portfolio_days p
       where p.user_id = ${alias}.id and p.day >= (now() at time zone 'UTC')::date - 7
       order by p.day desc limit 1
    ) lp on true
  ) st on true`;
}

/** Every live account with its stage: (id, stage). */
export const STAGE_SQL = `select u.id, st.stage from users u ${stageLateral("u")} where u.retired_into is null`;

export async function accountsByStage(): Promise<Record<StageName, number>> {
  const rows = (await getSql().query(`select stage, count(*)::int as n from (${STAGE_SQL}) s group by stage`)) as {
    stage: StageName;
    n: number;
  }[];
  const out: Record<StageName, number> = { none: 0, funded: 0, owns: 0 };
  for (const row of rows) out[row.stage] = Number(row.n);
  return out;
}

export type FirstBuySummary = {
  accounts: number;
  firstBuys: number;
  /** First buys / accounts, 0..1; null with no accounts. */
  rate: number | null;
  medianHours: number | null;
  withinADay: number;
  withinAWeek: number;
};

/** Over every live account: how many made a first buy, and how long it took (lib/first-buys). */
export async function firstBuySummary(): Promise<FirstBuySummary> {
  const rows = (await getSql().query(
    `with a as (${FIRST_BUY_PER_ACCOUNT_SQL})
     select count(*)::int as accounts,
            count(first_buy_at)::int as first_buys,
            count(*) filter (where first_buy_at < created_at + interval '1 day')::int as within_a_day,
            count(*) filter (where first_buy_at < created_at + interval '7 days')::int as within_a_week,
            round((percentile_cont(0.5) within group (order by case when first_buy_at is null then null else greatest(0, extract(epoch from first_buy_at - created_at)) end) / 3600)::numeric, 1) as median_hours
       from a`,
  )) as { accounts: number; first_buys: number; within_a_day: number; within_a_week: number; median_hours: string | number | null }[];
  const row = rows[0];
  const accounts = Number(row?.accounts ?? 0);
  const firstBuys = Number(row?.first_buys ?? 0);
  return {
    accounts,
    firstBuys,
    rate: accounts > 0 ? firstBuys / accounts : null,
    medianHours: row?.median_hours === null || row?.median_hours === undefined ? null : Number(row.median_hours),
    withinADay: Number(row?.within_a_day ?? 0),
    withinAWeek: Number(row?.within_a_week ?? 0),
  };
}

export type FirstBuyWeek = {
  week: string;
  signups: number;
  firstBuys: number;
  withinADay: number;
  withinAWeek: number;
  medianHours: number | null;
  gotIt: number;
};

/** The `pnpm first-buys` table, by signup week. */
/** `weeks` full weeks back plus this one (the same span as retentionByWeek(weeks + 1)). */
export async function firstBuysByWeek(weeks = 7): Promise<FirstBuyWeek[]> {
  const rows = (await getSql().query(FIRST_BUYS_SQL, [weeks])) as {
    week: string;
    signups: number;
    first_buys: number;
    within_a_day: number;
    within_a_week: number;
    median_hours: string | number | null;
    got_it: number;
  }[];
  return rows.map((row) => ({
    week: row.week,
    signups: Number(row.signups),
    firstBuys: Number(row.first_buys),
    withinADay: Number(row.within_a_day),
    withinAWeek: Number(row.within_a_week),
    medianHours: row.median_hours === null ? null : Number(row.median_hours),
    gotIt: Number(row.got_it),
  }));
}

/** When each live account last did anything Berth records (see the module note), as SQL: (id, created_at, last_active). */
export const LAST_ACTIVE_SQL = `
select u.id, u.created_at,
       greatest(
         u.last_seen_at,
         (select max(coalesce(o.placed_at, o.filled_at, o.created_at)) from orders o where o.user_id = u.id),
         (select max(c.created_at) from chat_usage c where c.user_id = u.id),
         (select max(m.created_at) from mcp_calls m where m.user_id = u.id)
       ) as last_active
  from users u
 where u.retired_into is null`;

export async function activeAccounts(): Promise<{ total: number; d7: number; d30: number }> {
  const rows = (await getSql().query(
    `select count(*)::int as total,
            count(*) filter (where last_active >= now() - interval '7 days')::int as d7,
            count(*) filter (where last_active >= now() - interval '30 days')::int as d30
       from (${LAST_ACTIVE_SQL}) a`,
  )) as { total: number; d7: number; d30: number }[];
  return { total: Number(rows[0]?.total ?? 0), d7: Number(rows[0]?.d7 ?? 0), d30: Number(rows[0]?.d30 ?? 0) };
}

export type OrderDay = {
  day: string;
  orders: number;
  buys: number;
  sells: number;
  /** Sum of usd_value where known. */
  volumeUsd: number;
  /** Orders with no dollar value, left out of the volume. */
  unpriced: number;
};

/** Filled orders per UTC day (by fill, else placement), the last `days` days, zero days kept. */
export async function ordersPerDay(days = 30): Promise<OrderDay[]> {
  const rows = (await getSql().query(
    `select to_char(d, 'YYYY-MM-DD') as day,
            count(o.id)::int as orders,
            count(o.id) filter (where o.direction = 'buy')::int as buys,
            count(o.id) filter (where o.direction = 'sell')::int as sells,
            coalesce(sum(o.usd_value), 0)::float8 as volume_usd,
            count(o.id) filter (where o.usd_value is null)::int as unpriced
       from generate_series((now() at time zone 'UTC')::date - ($1::int - 1), (now() at time zone 'UTC')::date, interval '1 day') d
       left join orders o on (coalesce(o.filled_at, o.placed_at, o.created_at) at time zone 'UTC')::date = d::date
      group by d order by d`,
    [days],
  )) as { day: string; orders: number; buys: number; sells: number; volume_usd: number; unpriced: number }[];
  return rows.map((row) => ({
    day: row.day,
    orders: Number(row.orders),
    buys: Number(row.buys),
    sells: Number(row.sells),
    volumeUsd: Number(row.volume_usd),
    unpriced: Number(row.unpriced),
  }));
}

export type VolumeTotals = { orders: number; volumeUsd: number; feeEstimateUsd: number; unpriced: number };

/** One order's fee in dollars: recorded where it can be priced, else the 0.4% estimate. */
const FEE_USD_SQL = `case when fee_amount is not null and pay_amount > 0 and usd_value is not null
                          then usd_value * fee_amount / pay_amount
                          else coalesce(usd_value, 0) * ${FEE_RATE_ESTIMATE} end`;

/** Every filled order ever, and the last 30 days: count, dollar volume and the 0.4% estimate. */
export async function volumeTotals(): Promise<{ all: VolumeTotals; d30: VolumeTotals }> {
  const rows = (await getSql().query(
    `select count(*)::int as orders,
            coalesce(sum(usd_value), 0)::float8 as volume,
            count(*) filter (where usd_value is null)::int as unpriced,
            coalesce(sum(${FEE_USD_SQL}), 0)::float8 as fee,
            coalesce(sum(${FEE_USD_SQL}) filter (where coalesce(filled_at, placed_at, created_at) >= now() - interval '30 days'), 0)::float8 as fee30,
            count(*) filter (where coalesce(filled_at, placed_at, created_at) >= now() - interval '30 days')::int as orders30,
            coalesce(sum(usd_value) filter (where coalesce(filled_at, placed_at, created_at) >= now() - interval '30 days'), 0)::float8 as volume30,
            count(*) filter (where usd_value is null and coalesce(filled_at, placed_at, created_at) >= now() - interval '30 days')::int as unpriced30
       from orders`,
  )) as { orders: number; volume: number; unpriced: number; fee: number; fee30: number; orders30: number; volume30: number; unpriced30: number }[];
  const row = rows[0];
  const totals = (orders: number, volume: number, fee: number, unpriced: number): VolumeTotals => ({
    orders,
    volumeUsd: volume,
    feeEstimateUsd: fee,
    unpriced,
  });
  return {
    all: totals(Number(row?.orders ?? 0), Number(row?.volume ?? 0), Number(row?.fee ?? 0), Number(row?.unpriced ?? 0)),
    d30: totals(Number(row?.orders30 ?? 0), Number(row?.volume30 ?? 0), Number(row?.fee30 ?? 0), Number(row?.unpriced30 ?? 0)),
  };
}

/** What every live account held at its latest stored close in the last week, summed. */
export async function holdingsValue(): Promise<{ totalUsd: number; accounts: number; asOf: string | null }> {
  const rows = (await getSql().query(
    `select coalesce(sum(p.value_usd), 0)::float8 as total, count(*)::int as accounts, to_char(max(p.day), 'YYYY-MM-DD') as as_of
       from (select distinct on (user_id) user_id, value_usd, day from portfolio_days
              where day >= (now() at time zone 'UTC')::date - 7 order by user_id, day desc) p
       join users u on u.id = p.user_id and u.retired_into is null`,
  )) as { total: number; accounts: number; as_of: string | null }[];
  return { totalUsd: Number(rows[0]?.total ?? 0), accounts: Number(rows[0]?.accounts ?? 0), asOf: rows[0]?.as_of ?? null };
}

export type RetentionWeek = {
  week: string;
  signups: number;
  /** Bought a stock or fund (not Cash) within 7 days of signing up. */
  orderedWeek1: number;
  /** Bought a stock or fund 7 to 35 days after signing up. */
  orderedWeeks2to5: number;
  /** Active (see the module note) in the last 30 days. */
  active30: number;
};

/**
 * By signup week, the last `weeks` weeks: who came back to order, and who
 * is still about. Berth keeps no visit log, so a week by week activity
 * grid cannot be drawn; orders can.
 */
export async function retentionByWeek(weeks = 8): Promise<RetentionWeek[]> {
  const rows = (await getSql().query(
    `with a as (${LAST_ACTIVE_SQL})
     select to_char(date_trunc('week', a.created_at at time zone 'UTC'), 'YYYY-MM-DD') as week,
            count(*)::int as signups,
            count(*) filter (where exists (select 1 from orders o where o.user_id = a.id and o.direction = 'buy' and o.listing_symbol <> 'SGOV'
                     and coalesce(o.placed_at, o.filled_at, o.created_at) < a.created_at + interval '7 days'))::int as w1,
            count(*) filter (where exists (select 1 from orders o where o.user_id = a.id and o.direction = 'buy' and o.listing_symbol <> 'SGOV'
                     and coalesce(o.placed_at, o.filled_at, o.created_at) >= a.created_at + interval '7 days'
                     and coalesce(o.placed_at, o.filled_at, o.created_at) < a.created_at + interval '35 days'))::int as w25,
            count(*) filter (where a.last_active >= now() - interval '30 days')::int as active30
       from a
      where a.created_at >= date_trunc('week', now() at time zone 'UTC') - make_interval(weeks => $1::int - 1)
      group by 1 order by 1`,
    [weeks],
  )) as { week: string; signups: number; w1: number; w25: number; active30: number }[];
  return rows.map((row) => ({
    week: row.week,
    signups: Number(row.signups),
    orderedWeek1: Number(row.w1),
    orderedWeeks2to5: Number(row.w25),
    active30: Number(row.active30),
  }));
}

export type Referrals = {
  /** Invite link landings (referral_clicks), all time and last 30 days. */
  clicks: number;
  clicks30: number;
  /** Live accounts that arrived with an invite code. */
  referredSignups: number;
  /** Of those, how many made a first buy. */
  referredFirstBuys: number;
  /** Friend links: requests made through one, and how many became friends. */
  linkRequests: number;
  linkAccepted: number;
};

export async function referrals(): Promise<Referrals> {
  const rows = (await getSql().query(
    `select (select count(*)::int from referral_clicks) as clicks,
            (select count(*)::int from referral_clicks where created_at >= now() - interval '30 days') as clicks30,
            (select count(*)::int from users where retired_into is null and referred_by is not null) as referred,
            (select count(*)::int from (${FIRST_BUY_PER_ACCOUNT_SQL} and u.referred_by is not null) r where r.first_buy_at is not null) as referred_buys,
            (select count(*)::int from friend_requests where via = 'link') as link_requests,
            (select count(*)::int from friend_requests where via = 'link' and status = 'accepted') as link_accepted`,
  )) as Record<string, number>[];
  const row = rows[0] ?? {};
  return {
    clicks: Number(row.clicks ?? 0),
    clicks30: Number(row.clicks30 ?? 0),
    referredSignups: Number(row.referred ?? 0),
    referredFirstBuys: Number(row.referred_buys ?? 0),
    linkRequests: Number(row.link_requests ?? 0),
    linkAccepted: Number(row.link_accepted ?? 0),
  };
}

export type ListingBuyers = { symbol: string; buyers: number; orders: number; volumeUsd: number };

/** The stocks and funds the most accounts bought, all time (Cash and sells left out). */
export async function topListings(limit = 10): Promise<ListingBuyers[]> {
  const rows = (await getSql().query(
    `select o.listing_symbol as symbol, count(distinct o.user_id)::int as buyers, count(*)::int as orders,
            coalesce(sum(o.usd_value), 0)::float8 as volume
       from orders o
       join users u on u.id = o.user_id and u.retired_into is null
      where o.direction = 'buy' and o.listing_symbol <> 'SGOV'
      group by 1 order by buyers desc, orders desc, symbol limit $1`,
    [limit],
  )) as { symbol: string; buyers: number; orders: number; volume: number }[];
  return rows.map((row) => ({ symbol: row.symbol, buyers: Number(row.buyers), orders: Number(row.orders), volumeUsd: Number(row.volume) }));
}

export type Overview = {
  signupsDaily: DayCount[];
  signupsWeekly: DayCount[];
  stages: Record<StageName, number>;
  firstBuys: FirstBuySummary;
  firstBuyWeeks: FirstBuyWeek[];
  active: { total: number; d7: number; d30: number };
  ordersDaily: OrderDay[];
  volume: { all: VolumeTotals; d30: VolumeTotals };
  holdings: { totalUsd: number; accounts: number; asOf: string | null };
  retention: RetentionWeek[];
  referrals: Referrals;
  topListings: ListingBuyers[];
};

/** Everything the Overview shows, read side by side. */
export async function readOverview(): Promise<Overview> {
  const [signupsDaily, signupsWeekly, stages, firstBuys, firstBuyWeeks, active, ordersDaily, volume, holdings, retention, refs, top] =
    await Promise.all([
      signupsPerDay(30),
      signupsPerWeek(12),
      accountsByStage(),
      firstBuySummary(),
      firstBuysByWeek(7),
      activeAccounts(),
      ordersPerDay(30),
      volumeTotals(),
      holdingsValue(),
      retentionByWeek(8),
      referrals(),
      topListings(10),
    ]);
  return {
    signupsDaily,
    signupsWeekly,
    stages,
    firstBuys,
    firstBuyWeeks,
    active,
    ordersDaily,
    volume,
    holdings,
    retention,
    referrals: refs,
    topListings: top,
  };
}
