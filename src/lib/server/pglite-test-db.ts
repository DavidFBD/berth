import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { SqlClient } from "@/lib/server/db";

/**
 * The till's second adapter: a real in-process Postgres (PGlite) with the
 * real db/schema.sql applied, so integration tests exercise the actual SQL
 * — the award CTE, the partial unique indexes, the claim window's interval
 * arithmetic — not a canned imitation of it. Test-only; never imported by
 * app code, so the devDependency stays out of the bundle.
 */
export async function makeTestDb(): Promise<{
  sql: SqlClient;
  close: () => Promise<void>;
}> {
  const db = new PGlite();
  await db.exec(readFileSync(join(process.cwd(), "db/schema.sql"), "utf8"));
  return {
    sql: {
      query: async (text, params) => (await db.query(text, params)).rows,
      transaction: (statements) =>
        db.transaction(async (tx) => {
          const out: unknown[][] = [];
          for (const statement of statements) out.push((await tx.query(statement.text, statement.params)).rows);
          return out;
        }),
    },
    close: () => db.close(),
  };
}
