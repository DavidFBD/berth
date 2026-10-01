/**
 * What a first buy is, in SQL, for `pnpm first-buys` and the staff
 * Overview alike: the first filled buy of a stock or fund (Cash, SGOV, is
 * not a first buy), by account, live accounts only (a merged account's
 * orders moved to its survivor). One statement of the rule, so the script
 * and the page can never disagree about it.
 */

/** Per live account: when it signed up, its first buy (or null), and when it closed the first stock card. */
export const FIRST_BUY_PER_ACCOUNT_SQL = `
select u.id, u.created_at,
       (select min(coalesce(o.filled_at, o.placed_at, o.created_at)) from orders o
         where o.user_id = u.id and o.direction = 'buy' and o.listing_symbol <> 'SGOV'
           and (o.fill_tx is not null or o.filled_at is not null)) as first_buy_at,
       u.first_stock_closed_at
  from users u
 where u.retired_into is null`;

/**
 * By ISO week of signup (Monday start, UTC), the last `$1` weeks: signups,
 * first buys, how many within a day and a week, the median hours to it,
 * and how many closed the first stock card ("Got it"). Weeks are UTC. A
 * first buy recorded before the account existed (an order recovered onto a
 * merge survivor) counts as at once, never as negative time.
 */
export const FIRST_BUYS_SQL = `
with signups as (
  ${FIRST_BUY_PER_ACCOUNT_SQL}
     and u.created_at >= (date_trunc('week', now() at time zone 'UTC') - make_interval(weeks => $1::int)) at time zone 'UTC'
)
select to_char(date_trunc('week', created_at at time zone 'UTC'), 'YYYY-MM-DD') as week,
       count(*)::int as signups,
       count(first_buy_at)::int as first_buys,
       count(*) filter (where first_buy_at < created_at + interval '1 day')::int as within_a_day,
       count(*) filter (where first_buy_at < created_at + interval '7 days')::int as within_a_week,
       round((percentile_cont(0.5) within group (order by case when first_buy_at is null then null else greatest(0, extract(epoch from first_buy_at - created_at)) end) / 3600)::numeric, 1) as median_hours,
       count(first_stock_closed_at)::int as got_it
  from signups
 group by 1
 order by 1`;
