// Read only: how many accounts made a first buy of a stock or fund, by the
// week they signed up, and how long it took. The measure for the first look
// (lib/first-look): compare the weeks after it shipped with the four before.
// Cash (SGOV) is not a first buy, and only a filled buy counts. Merged accounts are left out (their
// orders moved with them). Weeks are ISO weeks, Monday start, UTC.
//
// The SQL is lib/first-buys, which the staff Overview reads too.
//
// Usage: pnpm first-buys            (the last 12 weeks)
//        pnpm first-buys --weeks 26
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { FIRST_BUYS_SQL } from "@/lib/first-buys";

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



const sql = neon(process.env.DATABASE_URL);
const rows = await sql.query(FIRST_BUYS_SQL, [weeks]);
console.table(
  rows.map((row) => ({
    ...row,
    rate: row.signups ? `${Math.round((100 * row.first_buys) / row.signups)}%` : "",
  })),
);
