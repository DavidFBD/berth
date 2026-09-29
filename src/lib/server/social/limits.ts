import { getSql } from "@/lib/server/db";
import { sha256Hex } from "@/lib/server/oauth/crypto";

/**
 * Hour-window rate limits for every social read that could enumerate and
 * every social write, in the authorization server's table
 * (`oauth_rate_limits`, the same atomic upsert as lib/server/oauth/rate-limit)
 * under a `social:` prefix. Keys are hashed, never stored as given. The
 * evening prune clears windows older than a day.
 */

export const SOCIAL_LIMITS = {
  /** Cards opened by a signed in account. */
  card: 60,
  /** The picker's live availability check: itself an oracle, so it is tight. */
  check: 20,
  /** Username saves (the 30 day rule limits changes; this limits tries). */
  name: 10,
  /** New friend requests. */
  request: 20,
  /** Every other friend action: cancel, accept, decline, remove. */
  friend: 60,
  salute: 60,
  block: 30,
  report: 10,
  /** Hide, unhide, a new friend link. */
  settings: 30,
} as const;

export type SocialBucket = keyof typeof SOCIAL_LIMITS;

function windowStart(now: Date): string {
  const start = new Date(now);
  start.setUTCMinutes(0, 0, 0);
  return start.toISOString();
}

/** Take one place in `bucket` for `key` this hour; false once the limit is reached. */
export async function takeSocialPlace(bucket: SocialBucket, key: string, now = new Date()): Promise<boolean> {
  const rows = (await getSql().query(
    `insert into oauth_rate_limits (bucket, window_start, n) values ($1, $2::timestamptz, 1)
     on conflict (bucket, window_start) do update set n = oauth_rate_limits.n + 1
     returning n`,
    [`social:${bucket}:${sha256Hex(key)}`, windowStart(now)],
  )) as { n: number }[];
  return (rows[0]?.n ?? Infinity) <= SOCIAL_LIMITS[bucket];
}
