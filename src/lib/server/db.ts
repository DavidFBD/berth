import { neon } from "@neondatabase/serverless";
import { localPostgres } from "@/lib/server/db-local";

/**
 * The till's one seam to the database. Everything server-side speaks this
 * minimal interface — text + params in, rows out — so the implementation is
 * substitutable: Neon over HTTP in production, an in-process PGlite Postgres
 * in tests (see pglite-test-db.ts). Two adapters make the seam real, and
 * the SQL that guards the ledger becomes assertable instead of trusted.
 */
export type SqlClient = {
  query: (text: string, params?: unknown[]) => Promise<unknown>;
};

/**
 * Lazy Neon client. `neon()` throws when DATABASE_URL is missing and Next
 * evaluates module scope at build time, so construction waits for the first
 * request (per Vercel's storage guidance: plain lazy function, no Proxy).
 */
let _sql: SqlClient | null = null;

export function getSql(): SqlClient {
  if (!_sql) {
    // Development may aim at a local Postgres instead (db-local); production never does.
    const local = process.env.NODE_ENV !== "production" ? process.env.LOCAL_DATABASE_URL : undefined;
    _sql = local ? localPostgres(local) : (neon(process.env.DATABASE_URL!) as unknown as SqlClient);
  }
  return _sql;
}

/** Test-only injection point; pass null to fall back to Neon on next ask. */
export function setSqlClient(client: SqlClient | null): void {
  _sql = client;
}
