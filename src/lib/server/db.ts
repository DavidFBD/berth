import { neon } from "@neondatabase/serverless";

/**
 * Lazy Neon client. `neon()` throws when DATABASE_URL is missing and Next
 * evaluates module scope at build time, so construction waits for the first
 * request (per Vercel's storage guidance: plain lazy function, no Proxy).
 */
let _sql: ReturnType<typeof neon> | null = null;

export function getSql() {
  if (!_sql) _sql = neon(process.env.DATABASE_URL!);
  return _sql;
}
