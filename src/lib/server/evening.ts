import { backfillHistories, HISTORY_BACKFILL_PER_RUN, type HistoryBackfillSummary } from "@/lib/server/history-backfill";
import { refreshMarks, type MarksRunSummary } from "@/lib/server/marks";
import { fillOrderMarks, type OrderMarksSummary } from "@/lib/server/order-marks";
import { rebuildMergedPortfolios, runPortfolioSnapshot, type RebuildSummary, type SnapshotSummary } from "@/lib/server/portfolio";
import { pruneOAuth, type OAuthPruneSummary } from "@/lib/server/oauth/prune";
import { retryPendingSends, type RetrySummary } from "@/lib/server/email/send";
import { syncWaitingOrders, type LimitSyncSummary } from "@/lib/server/limit-orders";
import { settlePourClaims, type ClaimSummary } from "@/lib/server/pour-claims";
import { runAutopost, type AutopostSummary } from "@/lib/server/x-autopost";

/**
 * The one evening cron (vercel.json, 22:00 UTC on weekdays; the Hobby plan
 * allows two crons a project, once a day each, and the other is the morning
 * run, lib/server/morning). Three stages in order, each with its own budget inside the
 * function's sixty seconds, each run whatever the one before it did:
 *
 * 1. Marks: the last seven days' closes for every listing and benchmark
 *    (lib/server/marks refreshMarks), re-valuing any stored day a changed
 *    mark touched.
 * 2. Order marks: benchmark prices at the order's minute for up to ten
 *    orders still missing one (lib/server/order-marks).
 * 3. Snapshots: every account's value at today's close
 *    (lib/server/portfolio runPortfolioSnapshot). A Hobby cron fires
 *    anywhere in its hour; lib/portfolio-days snapshotDay still counts a
 *    run up to six hours past the 21:30 UTC mark as that evening's. It
 *    starts no account after its deadline.
 *
 * Alongside the marks, and within their budget, the authorization server's
 * housekeeping (lib/server/oauth/prune): expired codes, long dead tokens,
 * clients nobody ever granted. It is reported but never counts as a
 * failure of the run. So is the limit order pass (lib/server/limit-orders
 * syncWaitingOrders): every waiting limit order checked against SODAX's
 * backend, so a fill or an expiry is recorded for a person who never came
 * back to look. It rides this cron because Hobby allows no third. So does
 * the history of a merged account (lib/server/portfolio
 * rebuildMergedPortfolios), redrawn from its joined orders beside the order
 * marks, before the snapshot writes today's row over it. And beside both,
 * the history back to the first buy (lib/server/history-backfill) for a
 * few accounts whose stored days start after their first order: database
 * reads only, idempotent, never over a stored row.
 *
 * And beside the marks, Berth's own post on X (lib/server/x-autopost), once
 * every three days when X_AUTOPOST_ENABLED is "1": it never throws and
 * never counts as a failure of the run.
 *
 * A stage that throws or runs out of budget is reported as that and the
 * next one runs. The route answers 500 only when nothing at all was
 * written and something failed.
 */

export const MARKS_BUDGET_MS = 22_000;
export const ORDER_MARKS_BUDGET_MS = 10_000;
/**
 * The reads, a token refresh and one post (each request with a ten second
 * timeout), and a second refresh and post after a 401 only while
 * AUTOPOST_RETRY_NEEDS_MS remain (lib/server/x-autopost). Inside the route's
 * sixty seconds, so the function is never frozen between X rotating the
 * token and the new one being saved.
 */
export const AUTOPOST_BUDGET_MS = 45_000;
/** The snapshot starts no account after this long from the run's start. */
export const SNAPSHOT_DEADLINE_MS = 47_000;

export type Stage<T> = { ok: true; result: T } | { ok: false; error: string };

export type EveningSummary = {
  marks: Stage<MarksRunSummary>;
  orderMarks: Stage<OrderMarksSummary>;
  snapshot: Stage<SnapshotSummary>;
  oauthPrune: Stage<OAuthPruneSummary>;
  limitOrders: Stage<LimitSyncSummary>;
  /** Pours whose fill was not confirmed when XP was asked for (lib/server/pour-claims): paid once filled. */
  pourClaims: Stage<ClaimSummary>;
  /** Merged accounts whose history was redrawn from their joined orders. */
  rebuilds: Stage<RebuildSummary>;
  /** Accounts whose history was reached back to the first buy (lib/server/history-backfill). */
  histories: Stage<HistoryBackfillSummary>;
  /** Email notices pending more than ten minutes, sent again (lib/server/email). */
  emails: Stage<RetrySummary>;
  /** Berth's own post on X, when one was due (lib/server/x-autopost). */
  autopost: Stage<AutopostSummary>;
  /** Marks written or dropped, order prices written, portfolio days written. */
  written: number;
  failed: boolean;
};

async function stage<T>(work: () => Promise<T>, budgetMs: number): Promise<Stage<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`over its ${budgetMs}ms budget`)), budgetMs);
      }),
    ]);
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "failed" };
  } finally {
    clearTimeout(timer);
  }
}

export async function runEvening({
  now = new Date(),
  marks = () => refreshMarks(),
  orderMarks = () => fillOrderMarks(),
  snapshot = (deadline: number) => runPortfolioSnapshot({ now, deadline }),
  prune = () => pruneOAuth(now),
  limits = () => syncWaitingOrders({ now }),
  claims = () => settlePourClaims({ now }),
  rebuilds = () => rebuildMergedPortfolios({ now }),
  histories = (deadline: number) => backfillHistories({ write: true, limit: HISTORY_BACKFILL_PER_RUN, now, deadline }),
  emails = () => retryPendingSends(),
  autopost = () => runAutopost({ now: now.getTime(), deadline: Date.now() + AUTOPOST_BUDGET_MS }),
  budgets = { marks: MARKS_BUDGET_MS, orderMarks: ORDER_MARKS_BUDGET_MS, snapshotDeadline: SNAPSHOT_DEADLINE_MS },
}: {
  now?: Date;
  marks?: () => Promise<MarksRunSummary>;
  orderMarks?: () => Promise<OrderMarksSummary>;
  snapshot?: (deadline: number) => Promise<SnapshotSummary>;
  prune?: () => Promise<OAuthPruneSummary>;
  limits?: () => Promise<LimitSyncSummary>;
  claims?: () => Promise<ClaimSummary>;
  rebuilds?: () => Promise<RebuildSummary>;
  histories?: (deadline: number) => Promise<HistoryBackfillSummary>;
  emails?: () => Promise<RetrySummary>;
  autopost?: () => Promise<AutopostSummary>;
  budgets?: { marks: number; orderMarks: number; snapshotDeadline: number };
} = {}): Promise<EveningSummary> {
  const started = Date.now();
  // The post runs beside everything else and is awaited only at the end.
  const autopostRun = stage(autopost, AUTOPOST_BUDGET_MS);
  const [marksStage, pruneStage, limitStage, emailStage] = await Promise.all([
    stage(marks, budgets.marks),
    stage(prune, budgets.marks),
    stage(limits, budgets.marks),
    stage(emails, budgets.marks),
  ]);
  // After the limit pass, which records the fills the claims wait on.
  const claimStage = await stage(claims, budgets.orderMarks);
  // The history backfill skips accounts waiting on a rebuild, so the two
  // never write the same account's days at once.
  const historyDeadline = Date.now() + budgets.orderMarks - 2_000;
  const [orderStage, rebuildStage, historyStage] = await Promise.all([
    stage(orderMarks, budgets.orderMarks),
    stage(rebuilds, budgets.orderMarks),
    stage(() => histories(historyDeadline), budgets.orderMarks),
  ]);
  const deadline = started + budgets.snapshotDeadline;
  // The snapshot's own deadline stops new accounts; the budget is the
  // backstop for one still in flight (each has ACCOUNT_TIMEOUT_MS).
  const snapshotStage = await stage(
    () => snapshot(deadline),
    Math.max(deadline - Date.now(), 0) + 9_000,
  );
  if (snapshotStage.ok && snapshotStage.result.unreached > 0) {
    console.warn("[cron/evening] snapshot deadline reached;", snapshotStage.result.unreached, "accounts skipped");
  }

  const written =
    (marksStage.ok ? marksStage.result.written + marksStage.result.dropped : 0) +
    (orderStage.ok ? orderStage.result.written : 0) +
    (snapshotStage.ok ? snapshotStage.result.written : 0);
  const failed =
    !marksStage.ok ||
    marksStage.result.failures.length > 0 ||
    !orderStage.ok ||
    orderStage.result.failed > 0 ||
    !snapshotStage.ok ||
    snapshotStage.result.failed > 0;
  if (!pruneStage.ok) console.warn("[cron/evening] oauth prune failed:", pruneStage.error);
  if (!limitStage.ok) console.warn("[cron/evening] limit orders failed:", limitStage.error);
  if (!claimStage.ok) console.warn("[cron/evening] pour claims failed:", claimStage.error);
  if (!rebuildStage.ok) console.warn("[cron/evening] merged history failed:", rebuildStage.error);
  if (!historyStage.ok) console.warn("[cron/evening] history backfill failed:", historyStage.error);
  if (!emailStage.ok) console.warn("[cron/evening] email retry failed:", emailStage.error);
  const autopostStage = await autopostRun;
  if (!autopostStage.ok) console.warn("[cron/evening] x autopost failed:", autopostStage.error);
  return {
    marks: marksStage,
    orderMarks: orderStage,
    snapshot: snapshotStage,
    oauthPrune: pruneStage,
    limitOrders: limitStage,
    pourClaims: claimStage,
    rebuilds: rebuildStage,
    histories: historyStage,
    emails: emailStage,
    autopost: autopostStage,
    written:
      written +
      (rebuildStage.ok ? rebuildStage.result.written : 0) +
      (historyStage.ok ? historyStage.result.written : 0),
    failed,
  };
}
