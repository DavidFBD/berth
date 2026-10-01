import { getSql } from "@/lib/server/db";
import { scrubPersonal } from "@/lib/staff/mask";

/**
 * The record of each cron run (cron_runs), for the staff Health page: the
 * routes write their summary as they answer. The summary is the same JSON
 * the route logs, counts and stage outcomes only, scrubbed once more of
 * anything shaped like an email or a wallet before it is stored. A failed
 * write is logged and never changes the run's answer. Each write prunes
 * that job's rows older than 90 days; the evening's also prunes staff_audit
 * rows older than 24 months (pruneStaffAudit, on its own).
 */

export type CronJob = "morning" | "evening";

export const CRON_RUNS_KEEP_DAYS = 90;

export async function recordCronRun(job: CronJob, startedAt: Date, ok: boolean, summary: unknown): Promise<void> {
  try {
    const sql = getSql();
    await sql.query(`insert into cron_runs (job, started_at, ok, summary) values ($1, $2, $3, $4::jsonb)`, [
      job,
      startedAt.toISOString(),
      ok,
      JSON.stringify(scrubPersonal(summary ?? {})),
    ]);
    await sql.query(`delete from cron_runs where job = $1 and started_at < now() - make_interval(days => $2::int)`, [job, CRON_RUNS_KEEP_DAYS]);
  } catch (error) {
    console.warn(`[cron/${job}] run not recorded:`, error instanceof Error ? error.name : "error");
  }
  if (job === "evening") await pruneStaffAudit();
}

/** The staff audit log is kept 24 months (the privacy policy says so). Its own try: a cron_runs failure never stops it. */
export async function pruneStaffAudit(): Promise<void> {
  try {
    await getSql().query(`delete from staff_audit where at < now() - interval '24 months'`);
  } catch (error) {
    console.warn("[cron/evening] staff audit not pruned:", error instanceof Error ? error.name : "error");
  }
}

export type CronRun = { job: CronJob; startedAt: string; finishedAt: string; ok: boolean; summary: Record<string, unknown> };

export async function latestCronRuns(job: CronJob, limit = 7): Promise<CronRun[]> {
  const rows = (await getSql().query(
    `select job, started_at, finished_at, ok, summary from cron_runs where job = $1 order by started_at desc limit $2`,
    [job, limit],
  )) as { job: CronJob; started_at: string; finished_at: string; ok: boolean; summary: Record<string, unknown> }[];
  return rows.map((row) => ({
    job: row.job,
    startedAt: new Date(row.started_at).toISOString(),
    finishedAt: new Date(row.finished_at).toISOString(),
    ok: row.ok,
    summary: row.summary ?? {},
  }));
}

/** Each stage of a stored summary: its name, whether it ran clean, and its error if not. */
export function stageOutcomes(summary: Record<string, unknown>): { stage: string; ok: boolean; error: string | null; result: Record<string, unknown> | null }[] {
  const out: { stage: string; ok: boolean; error: string | null; result: Record<string, unknown> | null }[] = [];
  for (const [stage, value] of Object.entries(summary)) {
    if (!value || typeof value !== "object" || !("ok" in value)) continue;
    const entry = value as { ok: unknown; error?: unknown; result?: unknown };
    out.push({
      stage,
      ok: entry.ok === true,
      error: typeof entry.error === "string" ? entry.error : null,
      result: entry.result && typeof entry.result === "object" ? (entry.result as Record<string, unknown>) : null,
    });
  }
  return out;
}
