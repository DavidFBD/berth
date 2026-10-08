import { Sodax } from "@sodax/sdk";
import { getSql } from "@/lib/server/db";
import { sodaxConfig } from "@/lib/sodax-config";
import { isOpen } from "@/lib/market-calendar";
import {
  fetchHubPrices,
  quoteOnce,
  rowOf,
  sdkTokenLookup,
  smokeJobs,
  smokeVerdict,
  type SmokeAttempt,
  type SmokeJob,
  type SmokeRow,
  type SmokeVerdict,
} from "@/lib/quote-smoke";
import { deliver } from "@/lib/server/email/send";
import { staffAdminIds } from "@/lib/server/staff-gate";

/**
 * The quote canary (app/api/cron/canary): the quick quote matrix of
 * `pnpm smoke:quotes`, asked server side of the live solver every 30
 * minutes in US market hours by a GitHub Actions schedule (Vercel Hobby
 * allows two crons, both taken). Each run is kept in quote_canary_runs for
 * the staff Health page. After two failing runs in a row inside market
 * hours, every staff admin is emailed, at most once an hour (email_sends'
 * unique ref per admin per UTC hour), so a long outage is one email an
 * hour, not one every run.
 *
 * Server side it asks api.sodax.com directly with the house key, which is
 * exactly what the browser's proxy does on its behalf.
 */

export const CANARY_KEEP_DAYS = 30;
/** A run more than this before the current one does not count as "in a row" (runs are 30 minutes apart). */
export const IN_A_ROW_WINDOW_MS = 70 * 60 * 1000;
/** The whole run, well inside the route's 60 s: the oracle and every quote at once. */
export const CANARY_BUDGET_MS = 45_000;
const ORACLE_TIMEOUT_MS = 10_000;
const QUOTE_TIMEOUT_MS = 10_000;

/**
 * Pairs that changed between this run and the one before it (failing then
 * passing, or the other way): the canary's flapping, judged across runs.
 */
export function flappingAcross(previous: Pick<CanaryRun, "failed" | "startedAt"> | null, failedNow: SmokeRow[], now: Date): number {
  if (!previous || now.getTime() - new Date(previous.startedAt).getTime() > IN_A_ROW_WINDOW_MS) return 0;
  const id = (row: { dir: string; src: string; dst: string; usd: number }) => `${row.dir}:${row.src}:${row.dst}:${row.usd}`;
  const before = new Set(previous.failed.map(id));
  const after = new Set(failedNow.map(id));
  let changed = 0;
  for (const pair of before) if (!after.has(pair)) changed += 1;
  for (const pair of after) if (!before.has(pair)) changed += 1;
  return changed;
}
/** The failing pairs stored per run. */
const FAILED_KEEP = 20;

export type CanaryRun = {
  startedAt: string;
  verdict: SmokeVerdict["verdict"];
  marketOpen: boolean;
  quoted: number;
  total: number;
  flapping: number;
  controlOk: boolean;
  failed: { dir: string; src: string; dst: string; usd: number; status: string; code: number | null; message: string | null }[];
  alerted: boolean;
};

/** Whether this run should email staff: it failed, inside market hours, and so did the run just before it. */
export function shouldAlert({
  current,
  previous,
}: {
  current: Pick<CanaryRun, "verdict" | "marketOpen" | "startedAt">;
  previous: Pick<CanaryRun, "verdict" | "startedAt"> | null;
}): boolean {
  if (current.verdict === "pass" || !current.marketOpen || !previous || previous.verdict === "pass") return false;
  const gap = new Date(current.startedAt).getTime() - new Date(previous.startedAt).getTime();
  return gap > 0 && gap <= IN_A_ROW_WINDOW_MS;
}

/** The email's ref: one per admin per UTC hour, so email_sends' unique (type, ref) caps it at once an hour. */
export function alertRef(admin: string, now: Date): string {
  return `quotes_down:${admin}:${now.toISOString().slice(0, 13)}`;
}

/** "USDC on Base to NVDA: -4 No path was found", for the email. */
export function exampleLine(row: SmokeRow | undefined): string {
  if (!row) return "";
  const code = row.final.code !== undefined ? `${row.final.code} ` : "";
  const message = (row.final.message ?? row.final.status).replace(/0x[0-9a-f]{6,}/gi, (hex) => `${hex.slice(0, 6)}…`);
  return `${row.src} to ${row.dst}: ${code}${message}`.slice(0, 140);
}

function canarySodax(): Sodax {
  return new Sodax({ ...sodaxConfig, apiKey: process.env.SODAX_API_KEY || undefined });
}

export async function lastCanaryRuns(limit = 8): Promise<CanaryRun[]> {
  const rows = (await getSql().query(
    `select started_at, verdict, market_open, quoted, total, flapping, control_ok, failed, alerted
       from quote_canary_runs order by started_at desc limit $1`,
    [limit],
  )) as {
    started_at: string;
    verdict: CanaryRun["verdict"];
    market_open: boolean;
    quoted: number;
    total: number;
    flapping: number;
    control_ok: boolean;
    failed: CanaryRun["failed"] | null;
    alerted: boolean;
  }[];
  return rows.map((row) => ({
    startedAt: new Date(row.started_at).toISOString(),
    verdict: row.verdict,
    marketOpen: row.market_open,
    quoted: row.quoted,
    total: row.total,
    flapping: row.flapping,
    controlOk: row.control_ok,
    failed: row.failed ?? [],
    alerted: row.alerted,
  }));
}

async function recordRun(run: CanaryRun): Promise<void> {
  const sql = getSql();
  await sql.query(
    `insert into quote_canary_runs (started_at, verdict, market_open, quoted, total, flapping, control_ok, failed, alerted)
     values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
    [run.startedAt, run.verdict, run.marketOpen, run.quoted, run.total, run.flapping, run.controlOk, JSON.stringify(run.failed), run.alerted],
  );
  await sql.query(`delete from quote_canary_runs where started_at < now() - make_interval(days => $1::int)`, [CANARY_KEEP_DAYS]);
}

export type CanarySummary = {
  verdict: SmokeVerdict["verdict"];
  summary: string;
  marketOpen: boolean;
  quoted: number;
  total: number;
  flapping: number;
  alerted: boolean;
  emailed: number;
  recorded: boolean;
};

/**
 * One canary run: ask, keep, and email staff when it is the second
 * failure in a row inside market hours. Never throws; a store or email
 * failure is logged and said in the summary.
 */
export async function runCanary({
  now = new Date(),
  ask,
  jobs,
  budgetMs = CANARY_BUDGET_MS,
  send = deliver,
  admins = staffAdminIds(),
}: {
  now?: Date;
  ask?: (job: SmokeJob) => Promise<SmokeAttempt>;
  jobs?: SmokeJob[];
  /** The whole run's time, oracle included; whatever has not answered by then is a failure. */
  budgetMs?: number;
  send?: typeof deliver;
  admins?: readonly string[];
} = {}): Promise<CanarySummary> {
  const started = Date.now();
  const sodax = ask && jobs ? null : canarySodax();
  let matrix = jobs;
  if (!matrix) {
    try {
      matrix = smokeJobs({ full: false, tokenOn: sdkTokenLookup(sodax!), prices: await fetchHubPrices(fetch, ORACLE_TIMEOUT_MS) });
    } catch {
      // No oracle: nothing can be priced. A failed run, worded as such, not the solver's.
      matrix = [];
    }
  }

  // Every quote at once, each with its own deadline, no retry inside the run
  // (two failing runs in a row is the hysteresis, and flapping is judged
  // across runs). Whatever has not answered when the budget runs out is
  // recorded as a failure, so a slow outage still leaves a row and alerts.
  const quoteFn = ask ?? ((job: SmokeJob) => quoteOnce(sodax!, job, QUOTE_TIMEOUT_MS));
  const answers: (SmokeAttempt | undefined)[] = new Array(matrix.length);
  let budgetTimer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.all(matrix.map(async (job, i) => (answers[i] = await quoteFn(job)))),
    new Promise((resolve) => {
      budgetTimer = setTimeout(resolve, Math.max(0, budgetMs - (Date.now() - started)));
    }),
  ]);
  clearTimeout(budgetTimer);
  const rows: SmokeRow[] = matrix.map((job, i) =>
    rowOf(job, answers[i] ?? { status: "error", message: `no answer in the canary's ${Math.round(budgetMs / 1000)} s` }),
  );
  const verdict: SmokeVerdict = rows.length
    ? smokeVerdict(rows)
    : { verdict: "fail", failed: [], flapping: [], controlOk: false, summary: "The hub oracle did not answer; nothing was quoted." };

  let previous: CanaryRun | null = null;
  try {
    previous = (await lastCanaryRuns(1))[0] ?? null;
  } catch (error) {
    console.warn("[canary] last run not read:", error instanceof Error ? error.name : "error");
  }

  const run: CanaryRun = {
    startedAt: now.toISOString(),
    verdict: verdict.verdict,
    marketOpen: isOpen(now),
    quoted: rows.length - verdict.failed.length,
    total: rows.length,
    flapping: flappingAcross(previous, verdict.failed, now),
    controlOk: verdict.controlOk,
    failed: verdict.failed.slice(0, FAILED_KEEP).map((row) => ({
      dir: row.dir,
      src: row.src,
      dst: row.dst,
      usd: row.usd,
      status: row.final.status,
      code: row.final.code ?? null,
      message: row.final.message?.slice(0, 160) ?? null,
    })),
    alerted: false,
  };

  let emailed = 0;
  if (shouldAlert({ current: run, previous })) {
    for (const admin of admins) {
      const outcome = await send({
        userId: admin,
        ref: alertRef(admin, now),
        notice: {
          type: "quotes_down",
          solverSide: verdict.verdict === "solver_down",
          failed: verdict.failed.length,
          total: rows.length,
          example: exampleLine(verdict.failed[0]),
        },
      }).catch(() => "failed" as const);
      if (outcome === "sent") emailed += 1;
    }
    run.alerted = emailed > 0;
  }

  let recorded = true;
  try {
    await recordRun(run);
  } catch (error) {
    recorded = false;
    console.warn("[canary] run not recorded:", error instanceof Error ? error.name : "error");
  }

  return {
    verdict: run.verdict,
    summary: verdict.summary,
    marketOpen: run.marketOpen,
    quoted: run.quoted,
    total: run.total,
    flapping: run.flapping,
    alerted: run.alerted,
    emailed,
    recorded,
  };
}
