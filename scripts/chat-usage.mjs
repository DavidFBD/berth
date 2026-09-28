// What Ask, the in-app assistant, has cost: this month against
// CHAT_MONTHLY_BUDGET_USD, the last 7 days per day, per tool and errors by
// code, from the chat_usage table (counts and cost only, never words).
// Read only: every statement is a SELECT.
//
// Usage:
//   pnpm chat:usage            production (DATABASE_URL from .env.local)
//   pnpm chat:usage --local    the local Postgres in LOCAL_DATABASE_URL
import { readFileSync } from "node:fs";

try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)="?([^"]*)"?$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
} catch {
  // fall through to the checks below
}

const local = process.argv.includes("--local");
const url = local ? process.env.LOCAL_DATABASE_URL : process.env.DATABASE_URL;
if (!url) {
  console.error(local ? "LOCAL_DATABASE_URL not set." : "DATABASE_URL not set. Run `vercel env pull` first.");
  process.exit(1);
}

let query;
let end = async () => {};
if (local) {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  query = async (text) => (await pool.query(text)).rows;
  end = () => pool.end();
} else {
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url);
  query = (text) => sql.query(text);
}

function table(title, rows) {
  console.log(`\n${title}`);
  if (rows.length === 0) {
    console.log("  (none)");
    return;
  }
  const keys = Object.keys(rows[0]);
  const widths = keys.map((key) => Math.max(key.length, ...rows.map((row) => String(row[key] ?? "").length)));
  const line = (values) => "  " + values.map((value, i) => String(value ?? "").padEnd(widths[i])).join("  ");
  console.log(line(keys));
  for (const row of rows) console.log(line(keys.map((key) => row[key])));
}

const usd = (micros) => `$${(Number(micros) / 1e6).toFixed(4)}`;
const budget = Number(process.env.CHAT_MONTHLY_BUDGET_USD || 5);

try {
  const [month] = await query(
    `select count(*)::int as messages, count(distinct user_id)::int as users, coalesce(sum(cost_micros), 0)::bigint as micros
       from chat_usage where created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'`,
  );
  console.log(`This month (${local ? "local" : "production"}): ${month.messages} messages, ${month.users} accounts, ${usd(month.micros)} of $${budget} (${((Number(month.micros) / 1e6 / budget) * 100).toFixed(1)}%)`);
  const days = await query(
    `select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day, count(*)::int as messages, count(distinct user_id)::int as users,
            round(avg(input_tokens))::int as avg_in, round(avg(cache_read_tokens))::int as avg_cached, round(avg(output_tokens))::int as avg_out,
            sum(cost_micros)::bigint as micros
       from chat_usage where created_at >= now() - interval '7 days' group by 1 order by 1`,
  );
  table("Per day, last 7 days", days.map(({ micros, ...row }) => ({ ...row, cost: usd(micros) })));
  table(
    "Tools, last 7 days",
    await query(`select tool, count(*)::int as messages from chat_usage, unnest(tools) as tool where created_at >= now() - interval '7 days' group by 1 order by 2 desc`),
  );
  table("Errors, last 7 days", await query(`select error, count(*)::int as n from chat_usage where not ok and created_at >= now() - interval '7 days' group by 1 order by 2 desc`));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await end();
}
