import { after } from "next/server";
import type { AssistantId } from "@/lib/assistant-party";
import { getSql } from "@/lib/server/db";

/**
 * What the MCP server keeps about its own use, and the limit on it.
 *
 * Every tool call passes through `guarded` (lib/server/mcp/tools), which
 * asks `takeMcpPlace` before the tool runs and hands `recordMcpCall` one row
 * after. The row says which tool, for whom, through which assistant, whether
 * it worked and how long it took; never the arguments and never the output,
 * since both can carry what a person holds or asked.
 *
 * Neither may cost an answer. The row is written after the response is
 * sent (next/server `after`), and a missing table, before `pnpm db:push`,
 * warns once per instance and is otherwise ignored. The limit fails open:
 * if its query errors, the call goes ahead, with a warning.
 */

/** Tool calls one grant may make, per minute and per day (UTC). */
export const MCP_LIMITS = { perMinute: 30, perDay: 600 } as const;

/** How long mcp_calls rows are kept before the evening cron deletes them. */
export const MCP_CALLS_KEEP_DAYS = 90;

/** What an assistant is told when a grant is over its limit. */
export const RATE_LIMITED_TEXT = "Berth is getting a lot of requests from this assistant. Try again in a minute.";

export type McpCall = {
  userId: string;
  grantId: string;
  assistant: AssistantId | "other";
  tool: string;
  ok: boolean;
  /** A short code, never a message that could carry user data. */
  error: string | null;
  durationMs: number;
};

/** The window keys a call at `now` counts against, in oauth_rate_limits. */
export function mcpWindows(grantId: string, now: Date): { minute: [string, string]; day: [string, string] } {
  const minute = new Date(now);
  minute.setUTCSeconds(0, 0);
  const day = new Date(now);
  day.setUTCHours(0, 0, 0, 0);
  return {
    minute: [`mcp:minute:${grantId}`, minute.toISOString()],
    day: [`mcp:day:${grantId}`, day.toISOString()],
  };
}

/** Whether counts taken in both windows are still within the limits. */
export function withinMcpLimits(counts: { minute: number; day: number }): boolean {
  return counts.minute <= MCP_LIMITS.perMinute && counts.day <= MCP_LIMITS.perDay;
}

/**
 * Take one place for a grant in its minute and, only if the minute allows
 * the call, its day, in one statement (the oauth_rate_limits upsert, so
 * racing calls cannot both take the last place). A call refused by the
 * minute does not spend the day: an assistant retrying in a loop is held
 * to the minute's pace instead of locked out until midnight. True when the
 * call may go ahead, including when the query fails.
 */
export async function takeMcpPlace(grantId: string, now = new Date()): Promise<boolean> {
  const { minute, day } = mcpWindows(grantId, now);
  try {
    const rows = (await getSql().query(
      `with m as (
         insert into oauth_rate_limits (bucket, window_start, n)
         values ($1, $2::timestamptz, 1)
         on conflict (bucket, window_start) do update set n = oauth_rate_limits.n + 1
         returning n
       ), d as (
         insert into oauth_rate_limits (bucket, window_start, n)
         select $3, $4::timestamptz, 1 from m where m.n <= $5
         on conflict (bucket, window_start) do update set n = oauth_rate_limits.n + 1
         returning n
       )
       select (select n from m) as minute, (select n from d) as day`,
      [minute[0], minute[1], day[0], day[1], MCP_LIMITS.perMinute],
    )) as { minute: number | null; day: number | null }[];
    const row = rows[0];
    if (!row || row.minute === null) return true;
    // No day count means the minute refused the call before the day was spent.
    if (row.day === null) return false;
    return withinMcpLimits({ minute: Number(row.minute), day: Number(row.day) });
  } catch (error) {
    console.warn("[mcp] rate limit unavailable, letting the call through:", error instanceof Error ? error.message : error);
    return true;
  }
}

let warnedMissingTable = false;

/** Insert one row now. Errors are swallowed; a missing table warns once. */
export async function writeMcpCall(call: McpCall): Promise<void> {
  try {
    await getSql().query(
      `insert into mcp_calls (user_id, grant_id, assistant, tool, ok, error, duration_ms) values ($1, $2, $3, $4, $5, $6, $7)`,
      [call.userId, call.grantId, call.assistant, call.tool, call.ok, call.error, Math.max(0, Math.round(call.durationMs))],
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/mcp_calls/.test(message) && /does not exist/.test(message)) {
      if (!warnedMissingTable) console.warn("[mcp] mcp_calls table missing; usage is not recorded until db:push");
      warnedMissingTable = true;
      return;
    }
    console.warn("[mcp] could not record a call:", message);
  }
}

/** Test only: forget that the missing table was already reported. */
export function resetMcpUsageWarnings(): void {
  warnedMissingTable = false;
}

/**
 * Record a call without holding up the answer: after the response when
 * there is a request to wait for, otherwise (a script, a test) in the
 * background.
 */
export function recordMcpCall(call: McpCall): void {
  try {
    after(() => writeMcpCall(call));
  } catch {
    void writeMcpCall(call);
  }
}
