import { getSql } from "@/lib/server/db";
import { sha256Hex } from "@/lib/server/oauth/crypto";

/**
 * Rate limits for the authorization server, in fixed hour windows (table
 * `oauth_rate_limits`). Taking a place is one upsert that returns the new
 * count, so it is atomic: of two racing requests for the last place, the
 * row lock lets exactly one see a count within the limit. Callers are
 * keyed by a hash of their address, never the address itself.
 */

export type RateBucket = "register" | "register:all" | "cimd" | "account-wallets" | "account-merge" | "wallet-revoke" | "first-path" | "news" | "analytics-id" | "last-known" | "sodax-submit";

function windowStart(now: Date): string {
  const start = new Date(now);
  start.setUTCMinutes(0, 0, 0);
  return start.toISOString();
}

/** Take one place in `bucket` for `key` this hour; false when the limit is already reached. */
export async function takeRatePlace(bucket: RateBucket, key: string, limit: number, now = new Date()): Promise<boolean> {
  const rows = (await getSql().query(
    `insert into oauth_rate_limits (bucket, window_start, n) values ($1, $2::timestamptz, 1)
     on conflict (bucket, window_start) do update set n = oauth_rate_limits.n + 1
     returning n`,
    [`${bucket}:${sha256Hex(key)}`, windowStart(now)],
  )) as { n: number }[];
  return (rows[0]?.n ?? Infinity) <= limit;
}

/** Thrown where a limit stops an authorize request; the page answers with its calm "try again". */
export class RateLimitedError extends Error {
  constructor(what: string) {
    super(`rate limited: ${what}`);
    this.name = "RateLimitedError";
  }
}
