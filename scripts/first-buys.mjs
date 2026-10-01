// Read only: how many accounts made a first buy of a stock or fund, by the
// week they signed up, and how long it took. The measure for the first look
// (lib/first-look): compare the weeks after it shipped with the four before.
// Cash (SGOV) is not a first buy, and only a filled buy counts. Merged accounts are left out (their
// orders moved with them). Weeks are ISO weeks, Monday start, UTC.
//
// Usage: pnpm first-buys            (the last 12 weeks)
//        pnpm first-buys --weeks 26
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const match = line.match(/^([A-Z0-9_]+)="?([^"]*)"?$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
  } catch {
    // fall through to the check below
  }
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set. Run `vercel env pull` first.");
  process.exit(1);
}

const at = process.argv.indexOf("--weeks");
const weeks = Math.max(1, Math.min(104, Number(at > -1 ? process.argv[at + 1] : 12) || 12));

export const FIRST_BUYS_SQL = `
with signups as (
  select u.id, u.created_at,
         (select min(coalesce(o.filled_at, o.placed_at, o.created_at)) from orders o
           where o.user_id = u.id and o.direction = 'buy' and o.listing_symbol <> 'SGOV'
             and (o.fill_tx is not null or o.filled_at is not null)) as first_buy_at,
         u.first_stock_closed_at
    from users u
   where u.retired_into is null
     and u.created_at >= date_trunc('week', now()) - make_interval(weeks => $1::int)
)
select to_char(date_trunc('week', created_at), 'YYYY-MM-DD') as week,
       count(*)::int as signups,
       count(first_buy_at)::int as first_buys,
       count(*) filter (where first_buy_at < created_at + interval '1 day')::int as within_a_day,
       count(*) filter (where first_buy_at < created_at + interval '7 days')::int as within_a_week,
       round((percentile_cont(0.5) within group (order by extract(epoch from first_buy_at - created_at)) / 3600)::numeric, 1) as median_hours,
       count(first_stock_closed_at)::int as got_it
  from signups
 group by 1
 order by 1`;

const sql = neon(process.env.DATABASE_URL);
const rows = await sql.query(FIRST_BUYS_SQL, [weeks]);
console.table(
  rows.map((row) => ({
    ...row,
    rate: row.signups ? `${Math.round((100 * row.first_buys) / row.signups)}%` : "",
  })),
);
