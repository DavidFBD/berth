import { after } from "next/server";
import { getSql } from "@/lib/server/db";
import { CHAT_LIMITS, chatWindows, dayStart, monthStart } from "@/lib/server/chat/limits";

/**
 * What Berth keeps about the chat: counts and cost, never what was said.
 * One chat_usage row per message (db/schema.sql): who, which model, how many
 * steps, which tools by name, the tokens, the cost, whether it worked and
 * how long it took. The places (per minute, per day) ride the same
 * oauth_rate_limits upsert the MCP limit uses (lib/server/mcp/usage).
 *
 * Unlike MCP's limit, this one fails closed: the chat spends real money,
 * so when the counts cannot be read the route says the assistant is not
 * available rather than letting the message through uncounted. Before
 * `pnpm db:push` creates chat_usage, that is what everyone sees.
 */

/** How long chat_usage rows are kept before the evening cron deletes them. */
export const CHAT_USAGE_KEEP_DAYS = 90;

export type ChatUsageRow = {
  userId: string;
  provider: string;
  model: string;
  steps: number;
  tools: string[];
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  costMicros: number;
  ok: boolean;
  /** A short code only. */
  error: string | null;
  durationMs: number;
};

/**
 * Take one place in the minute and, only if the minute allows it, the day,
 * in one statement. Returns both counts after the take (day null when the
 * minute refused before the day was spent).
 */
export async function takeChatPlace(userId: string, now = new Date()): Promise<{ minute: number; day: number | null }> {
  const { minute, day } = chatWindows(userId, now);
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
    [minute[0], minute[1], day[0], day[1], CHAT_LIMITS.perMinute],
  )) as { minute: number | null; day: number | null }[];
  const row = rows[0];
  return { minute: Number(row?.minute ?? 0), day: row?.day === null || row?.day === undefined ? null : Number(row.day) };
}

/** Messages already counted today, without taking one. */
export async function messagesToday(userId: string, now = new Date()): Promise<number> {
  const { day } = chatWindows(userId, now);
  const rows = (await getSql().query(`select n from oauth_rate_limits where bucket = $1 and window_start = $2::timestamptz`, day)) as {
    n: number;
  }[];
  return Number(rows[0]?.n ?? 0);
}

/** What this person's messages have cost today, USD millionths. */
export async function costTodayMicros(userId: string, now = new Date()): Promise<number> {
  const rows = (await getSql().query(
    `select coalesce(sum(cost_micros), 0)::bigint as micros from chat_usage where user_id = $1 and created_at >= $2::timestamptz`,
    [userId, dayStart(now).toISOString()],
  )) as { micros: string | number }[];
  return Number(rows[0]?.micros ?? 0);
}

/** What this person's messages have cost this month, USD millionths. */
export async function costMonthMicros(userId: string, now = new Date()): Promise<number> {
  const rows = (await getSql().query(
    `select coalesce(sum(cost_micros), 0)::bigint as micros from chat_usage where user_id = $1 and created_at >= $2::timestamptz`,
    [userId, monthStart(now).toISOString()],
  )) as { micros: string | number }[];
  return Number(rows[0]?.micros ?? 0);
}

let monthCache: { key: string; micros: number; at: number } | null = null;

/** What the chat has cost everyone this month, read at most once a minute per instance. */
export async function monthSpendMicros(now = new Date(), clock = () => Date.now()): Promise<number> {
  const key = monthStart(now).toISOString();
  if (monthCache && monthCache.key === key && clock() - monthCache.at < 60_000) return monthCache.micros;
  const rows = (await getSql().query(`select coalesce(sum(cost_micros), 0)::bigint as micros from chat_usage where created_at >= $1::timestamptz`, [
    key,
  ])) as { micros: string | number }[];
  const micros = Number(rows[0]?.micros ?? 0);
  monthCache = { key, micros, at: clock() };
  return micros;
}

/** Count a message's cost into this instance's cached month at once, so the budget does not wait a minute to see it. */
function addToMonth(micros: number): void {
  if (monthCache) monthCache.micros += micros;
}

/** Test only: forget the cached month. */
export function resetChatUsageCache(): void {
  monthCache = null;
}

const COLUMNS = `user_id, provider, model, steps, tools, input_tokens, cache_read_tokens, cache_write_tokens, output_tokens, reasoning_tokens, cost_micros, ok, error, duration_ms`;

function values(row: ChatUsageRow): unknown[] {
  return [
    row.userId,
    row.provider,
    row.model,
    Math.max(0, Math.min(32767, Math.round(row.steps))),
    row.tools,
    Math.max(0, Math.round(row.inputTokens)),
    Math.max(0, Math.round(row.cacheReadTokens)),
    Math.max(0, Math.round(row.cacheWriteTokens)),
    Math.max(0, Math.round(row.outputTokens)),
    Math.max(0, Math.round(row.reasoningTokens)),
    Math.max(0, Math.round(row.costMicros)),
    row.ok,
    row.error,
    Math.max(0, Math.round(row.durationMs)),
  ];
}

/**
 * Open a message's row before the model runs, carrying an estimate of what
 * it may cost (error "provisional"). The day's and the month's sums count
 * it at once, and if the function is cut off (maxDuration, a crash) the
 * estimate stands instead of nothing. Settled with the real numbers when
 * the message ends. Returns the row's id; throws if it cannot be written,
 * and the route then refuses the message (the counts must hold).
 */
export async function openChatUsage(row: ChatUsageRow): Promise<string> {
  const rows = (await getSql().query(
    `insert into chat_usage (${COLUMNS}) values ($1, $2, $3, $4, $5::text[], $6, $7, $8, $9, $10, $11, $12, $13, $14) returning id`,
    values(row),
  )) as { id: string | number }[];
  addToMonth(row.costMicros);
  return String(rows[0].id);
}

export async function settleChatUsage(id: string, row: ChatUsageRow, provisionalMicros: number): Promise<void> {
  try {
    await getSql().query(
      `update chat_usage set (${COLUMNS}) = ($2, $3, $4, $5, $6::text[], $7, $8, $9, $10, $11, $12, $13, $14, $15) where id = $1`,
      [id, ...values(row)],
    );
    addToMonth(row.costMicros - provisionalMicros);
  } catch (error) {
    // The provisional estimate stays, which errs on the side of the budget.
    console.warn("[chat] could not settle usage:", error instanceof Error ? error.name : "error");
  }
}

/** Settle without holding up the stream: after the response when there is one, else now. */
export function recordChatUsage(id: string, row: ChatUsageRow, provisionalMicros: number): void {
  try {
    after(() => settleChatUsage(id, row, provisionalMicros));
  } catch {
    void settleChatUsage(id, row, provisionalMicros);
  }
}
