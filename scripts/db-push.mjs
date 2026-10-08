// Applies db/schema.sql to the Neon database. Node doesn't auto-load
// .env.local (only Next.js does), so read it by hand.
// Usage: node scripts/db-push.mjs
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { markSchemaPushed } from "./lib/verify-marker.mjs";

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
// The http driver runs one statement per query; split on the boundaries
// between statements (semicolon at end of line). Statements inside a DO
// block lead with their semicolons, so a block stays whole.
const statements = schema
  .split(/;\s*\n/)
  .map((statement) => statement.trim())
  .filter((statement) => statement.length > 0);

// All or nothing: every statement in one Postgres transaction (the http
// driver's non-interactive sql.transaction). A statement that fails rolls
// back every one before it, so a push from an older schema.sql can never
// leave a constraint dropped and the rest of the file unapplied. The file
// holds nothing a transaction refuses (no `create index concurrently`).
try {
  await sql.transaction((txn) => statements.map((statement) => txn.query(statement)));
} catch (error) {
  console.error(`Nothing applied: the push failed and was rolled back whole.\n${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
console.log(`Applied ${statements.length} statements in one transaction. Schema is up to date.`);
// Record which schema reached Neon, so `pnpm verify` knows a schema change
// in the branch was applied before its code ships.
try {
  markSchemaPushed(schema);
} catch {
  // outside a git checkout: nothing to record
}
