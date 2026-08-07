// Applies db/schema.sql to the Neon database. Node doesn't auto-load
// .env.local (only Next.js does), so read it by hand.
// Usage: node scripts/db-push.mjs
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

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set. Run `vercel env pull` first.");
  process.exit(1);
}

const sql = neon(url);
const schema = readFileSync("db/schema.sql", "utf8");
// The http driver runs one statement per call; split on the blank-line
// boundaries between statements (semicolon at end of line).
const statements = schema
  .split(/;\s*\n/)
  .map((statement) => statement.trim())
  .filter((statement) => statement.length > 0);

for (const statement of statements) {
  await sql.query(statement);
}
console.log(`Applied ${statements.length} statements. Schema is up to date.`);
