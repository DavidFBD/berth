import { getSql } from "@/lib/server/db";
import { MCP_CALLS_KEEP_DAYS } from "@/lib/server/mcp/usage";

/**
 * The authorization server's housekeeping, run by the evening cron
 * (lib/server/evening; the Hobby plan allows two crons, so it rides along
 * rather than adding one). Removes:
 *
 * - codes an hour past expiry (kept that long so a replay just after
 *   expiry is still recognised as one);
 * - tokens expired, or revoked, more than a week ago;
 * - clients registered more than a week ago that no grant ever named;
 * - rate limit windows older than a day;
 * - MCP usage rows (mcp_calls) older than 90 days.
 *
 * A refresh token deleted this way, if ever presented again, is simply
 * unknown rather than a detected reuse; a week past its end, that is fine.
 */

export const PRUNE_AFTER_DAYS = 7;

export type OAuthPruneSummary = { codes: number; tokens: number; clients: number; rateWindows: number; mcpCalls: number };

export async function pruneOAuth(now = new Date()): Promise<OAuthPruneSummary> {
  const sql = getSql();
  const at = now.toISOString();
  const count = async (text: string, params: unknown[] = [at, PRUNE_AFTER_DAYS]) =>
    ((await sql.query(`with gone as (${text} returning 1) select count(*)::int as n from gone`, params)) as { n: number }[])[0]?.n ?? 0;
  const codes = await count(`delete from oauth_codes where expires_at < $1::timestamptz - interval '1 hour'`, [at]);
  const tokens = await count(
    `delete from oauth_tokens
      where expires_at < $1::timestamptz - make_interval(days => $2::int)
         or revoked_at < $1::timestamptz - make_interval(days => $2::int)`,
  );
  const clients = await count(
    `delete from oauth_clients c
      where c.created_at < $1::timestamptz - make_interval(days => $2::int)
        and not exists (select 1 from oauth_grants g where g.client_id = c.client_id)
        and not exists (select 1 from oauth_codes k where k.client_id = c.client_id and k.expires_at > $1::timestamptz)`,
  );
  const rateWindows = await count(`delete from oauth_rate_limits where window_start < $1::timestamptz - interval '1 day'`, [at]);
  // Before db:push the table may not exist yet; the rest of the prune still counts.
  const mcpCalls = await count(`delete from mcp_calls where created_at < $1::timestamptz - make_interval(days => $2::int)`, [
    at,
    MCP_CALLS_KEEP_DAYS,
  ]).catch(() => 0);
  return { codes, tokens, clients, rateWindows, mcpCalls };
}
