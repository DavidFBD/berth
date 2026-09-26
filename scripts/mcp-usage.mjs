// How assistants used Berth's MCP server over the last 7 days, from the
// mcp_calls table: calls per day, per tool, per assistant, errors by code,
// and distinct accounts. Read only: every statement is a SELECT.
//
// Usage:
//   pnpm mcp:usage            production (DATABASE_URL from .env.local)
//   pnpm mcp:usage --local    the local Postgres in LOCAL_DATABASE_URL
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

const WINDOW = `created_at >= now() - interval '7 days'`;

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

try {
  const [totals] = await query(
    `select count(*)::int as calls, count(distinct user_id)::int as users, count(distinct grant_id)::int as grants,
            count(*) filter (where not ok)::int as errors
       from mcp_calls where ${WINDOW}`,
  );
  console.log(`Last 7 days (${local ? "local" : "production"}): ${totals.calls} calls, ${totals.users} accounts, ${totals.grants} connections, ${totals.errors} errors`);
  table(
    "Per day (UTC)",
    await query(
      `select to_char(date_trunc('day', created_at at time zone 'UTC'), 'YYYY-MM-DD') as day, count(*)::int as calls,
              count(distinct user_id)::int as users, count(*) filter (where not ok)::int as errors
         from mcp_calls where ${WINDOW} group by 1 order by 1`,
    ),
  );
  table(
    "Per tool",
    await query(
      `select tool, count(*)::int as calls, count(*) filter (where not ok)::int as errors,
              round(avg(duration_ms))::int as avg_ms, percentile_disc(0.95) within group (order by duration_ms) as p95_ms
         from mcp_calls where ${WINDOW} group by tool order by calls desc`,
    ),
  );
  table(
    "Per assistant",
    await query(
      `select coalesce(assistant, 'unknown') as assistant, count(*)::int as calls, count(distinct user_id)::int as users
         from mcp_calls where ${WINDOW} group by 1 order by calls desc`,
    ),
  );
  table(
    "Errors",
    await query(
      `select coalesce(error, 'unknown') as error, count(*)::int as calls
         from mcp_calls where ${WINDOW} and not ok group by 1 order by calls desc`,
    ),
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(/does not exist/.test(message) ? "No mcp_calls table here yet (run db:push to create it)." : message);
  process.exitCode = 1;
} finally {
  await end();
}
