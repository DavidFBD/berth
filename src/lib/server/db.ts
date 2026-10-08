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
  /**
   * Several statements in one Postgres transaction, each answering its rows
   * in order (Neon's non-interactive transaction over HTTP). What makes
   * `pg_advisory_xact_lock` mean something: the lock taken by the first
   * statement holds until the last commits, and each later statement reads
   * a fresh snapshot after it.
   */
  transaction?: (statements: readonly SqlStatement[], options?: TransactionOptions) => Promise<unknown[][]>;
};

export type SqlStatement = { text: string; params?: unknown[] };

/**
 * A transaction's isolation, pinned where a lock pattern depends on it.
 * Only ReadCommitted is offered: under it each statement after a
 * `pg_advisory_xact_lock` reads a fresh snapshot, so it sees what the
 * transaction that held the lock before it committed. Under RepeatableRead
 * or Serializable the snapshot would be taken before the wait, and two
 * judges could pay against the same room (review: pin it, never rely on
 * the server's default).
 */
export type TransactionOptions = { isolationLevel: "ReadCommitted" };

/**
 * Run statements in one transaction. A client without one (a test double)
 * runs them in order, which is exactly right for a single connection.
 */
export async function inTransaction(statements: readonly SqlStatement[], options?: TransactionOptions): Promise<unknown[][]> {
  const sql = getSql();
  if (sql.transaction) return sql.transaction(statements, options);
  const out: unknown[][] = [];
  for (const statement of statements) out.push((await sql.query(statement.text, statement.params)) as unknown[]);
  return out;
}

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
    _sql = local ? localPostgres(local) : neonClient(process.env.DATABASE_URL!);
  }
  return _sql;
}

/** Test-only injection point; pass null to fall back to Neon on next ask. */
export function setSqlClient(client: SqlClient | null): void {
  _sql = client;
}

/** Neon over HTTP behind the seam, its transaction included. */
function neonClient(url: string): SqlClient {
  const sql = neon(url);
  return {
    query: (text, params) => sql.query(text, params ?? []),
    transaction: async (statements, options) =>
      (await sql.transaction(
        statements.map((statement) => sql.query(statement.text, statement.params ?? [])),
        options ? { isolationLevel: options.isolationLevel } : undefined,
      )) as unknown[][],
  };
}
