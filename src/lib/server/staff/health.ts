import { getSql } from "@/lib/server/db";
import { latestCronRuns, type CronRun } from "@/lib/server/cron-runs";
import { dailyCap, listingsDailyCap, weeklyDailyCap } from "@/lib/server/email/send";
import { dailyPostCap } from "@/lib/x-schedule";
import { scrubText } from "@/lib/staff/mask";
import { lastCanaryRuns, type CanaryRun } from "@/lib/server/quote-canary";

/**
 * The staff Health page: is the machinery running. Counts, states and
 * times only; no row names a person. The GitHub read uses the same token
 * the error reporter files with (GITHUB_ISSUE_TOKEN), read only.
 */

export type EmailToday = {
  byType: { type: string; going: number; failed: number }[];
  total: number;
  caps: { all: number; weekly: number; listings: number };
  suppressions: { reason: string; n: number; last30: number }[];
  stuck: { id: string; type: string; attempts: number; at: string; error: string | null }[];
};

export async function emailToday(): Promise<EmailToday> {
  const sql = getSql();
  const [types, suppressions, stuck] = await Promise.all([
    sql.query(
      `select type,
              count(*) filter (where status in ('sent', 'pending'))::int as going,
              count(*) filter (where status = 'failed')::int as failed
         from email_sends
        where created_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'
        group by type order by type`,
    ),
    sql.query(
      `select reason, count(*)::int as n, count(*) filter (where at >= now() - interval '30 days')::int as last30
         from email_suppressions group by reason order by reason`,
    ),
    sql.query(
      `select id, type, attempts, created_at, error from email_sends
        where status = 'pending' and created_at < now() - interval '10 minutes'
        order by created_at limit 50`,
    ),
  ]);
  const byType = (types as { type: string; going: number; failed: number }[]).map((row) => ({
    type: row.type,
    going: Number(row.going),
    failed: Number(row.failed),
  }));
  return {
    byType,
    total: byType.reduce((sum, row) => sum + row.going, 0),
    caps: { all: dailyCap(), weekly: weeklyDailyCap(), listings: listingsDailyCap() },
    suppressions: (suppressions as { reason: string; n: number; last30: number }[]).map((row) => ({
      reason: row.reason,
      n: Number(row.n),
      last30: Number(row.last30),
    })),
    stuck: (stuck as { id: string; type: string; attempts: number; created_at: string; error: string | null }[]).map((row) => ({
      id: row.id,
      type: row.type,
      attempts: Number(row.attempts),
      at: new Date(row.created_at).toISOString(),
      error: row.error ? scrubText(row.error) : null,
    })),
  };
}

export type XHealth = {
  used: number;
  reserved: number;
  requests: number;
  cap: number;
  stored: number;
  lastFetch: { at: string; ok: boolean | null; posts: number | null } | null;
  failing: number;
};

export async function xHealth(now = new Date()): Promise<XHealth> {
  const day = now.toISOString().slice(0, 10);
  const rows = (await getSql().query(
    `select (select used from x_read_budget where day = $1) as used,
            (select reserved from x_read_budget where day = $1) as reserved,
            (select requests from x_read_budget where day = $1) as requests,
            (select count(*)::int from x_posts) as stored,
            (select count(*)::int from x_queries where failed_at is not null and (fetched_at is null or failed_at > fetched_at)) as failing`,
    [day],
  )) as Record<string, number | null>[];
  const slots = (await getSql().query(`select claimed_at, ok, posts from x_fetch_slots order by claimed_at desc limit 1`)) as {
    claimed_at: string;
    ok: boolean | null;
    posts: number | null;
  }[];
  const row = rows[0] ?? {};
  return {
    used: Number(row.used ?? 0),
    reserved: Number(row.reserved ?? 0),
    requests: Number(row.requests ?? 0),
    cap: dailyPostCap(),
    stored: Number(row.stored ?? 0),
    lastFetch: slots[0] ? { at: new Date(slots[0].claimed_at).toISOString(), ok: slots[0].ok, posts: slots[0].posts === null ? null : Number(slots[0].posts) } : null,
    failing: Number(row.failing ?? 0),
  };
}

export type WaitingWork = {
  claimsOpen: number;
  claimsStuck: { tx: string; direction: string; at: string; lastCheckedAt: string | null }[];
  limits: { resting: number; partial: number; oldestCheckAt: string | null };
};

/** Order claims waiting (stuck: over two days) and limit orders waiting for a solver. */
export async function waitingWork(): Promise<WaitingWork> {
  const sql = getSql();
  const [claims, stuck, limits] = await Promise.all([
    sql.query(`select count(*)::int as n from pour_claims where settled_at is null`),
    sql.query(
      `select intent_tx, direction, created_at, last_checked_at from pour_claims
        where settled_at is null and created_at < now() - interval '2 days' order by created_at limit 50`,
    ),
    sql.query(
      `select count(*) filter (where status = 'resting')::int as resting, count(*) filter (where status = 'partial')::int as partial,
              min(checked_at) as oldest
         from limit_orders where status in ('resting', 'partial')`,
    ),
  ]);
  const limit = (limits as { resting: number; partial: number; oldest: string | null }[])[0];
  return {
    claimsOpen: Number((claims as { n: number }[])[0]?.n ?? 0),
    claimsStuck: (stuck as { intent_tx: string; direction: string; created_at: string; last_checked_at: string | null }[]).map((row) => ({
      tx: `${row.intent_tx.slice(0, 6)}…${row.intent_tx.slice(-4)}`,
      direction: row.direction,
      at: new Date(row.created_at).toISOString(),
      lastCheckedAt: row.last_checked_at ? new Date(row.last_checked_at).toISOString() : null,
    })),
    limits: { resting: Number(limit?.resting ?? 0), partial: Number(limit?.partial ?? 0), oldestCheckAt: limit?.oldest ? new Date(limit.oldest).toISOString() : null },
  };
}

export type IssueList =
  | { state: "off" }
  | { state: "failed" }
  | { state: "ok"; repo: string; issues: { number: number; title: string; url: string; comments: number; updatedAt: string }[] };

/** Open auto-reported issues on the app repo, newest activity first, cached five minutes. */
export async function errorReports(env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): Promise<IssueList> {
  const token = env.GITHUB_ISSUE_TOKEN;
  if (!token) return { state: "off" };
  const repo = env.GITHUB_ISSUE_REPO ?? "DavidFBD/lsteatime";
  try {
    const response = await fetchImpl(`https://api.github.com/repos/${repo}/issues?state=open&labels=auto-reported&sort=updated&per_page=20`, {
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" },
      signal: AbortSignal.timeout(5_000),
      next: { revalidate: 300 },
    } as RequestInit);
    if (!response.ok) return { state: "failed" };
    const body = (await response.json()) as { number: number; title: string; html_url: string; comments: number; updated_at: string; pull_request?: unknown }[];
    return {
      state: "ok",
      repo,
      issues: body
        .filter((issue) => !issue.pull_request)
        .map((issue) => ({ number: issue.number, title: scrubText(issue.title), url: issue.html_url, comments: issue.comments, updatedAt: issue.updated_at })),
    };
  } catch {
    return { state: "failed" };
  }
}

export type Health = {
  morning: CronRun[];
  evening: CronRun[];
  email: EmailToday;
  x: XHealth;
  waiting: WaitingWork;
  issues: IssueList;
  /** The quote canary's latest runs, newest first; null when they cannot be read (the table not pushed yet). */
  quotes: CanaryRun[] | null;
};

export async function readHealth(): Promise<Health> {
  const [morning, evening, email, x, waiting, issues, quotes] = await Promise.all([
    latestCronRuns("morning", 7),
    latestCronRuns("evening", 7),
    emailToday(),
    xHealth(),
    waitingWork(),
    errorReports(),
    lastCanaryRuns(8).catch(() => null),
  ]);
  return { morning, evening, email, x, waiting, issues, quotes };
}
