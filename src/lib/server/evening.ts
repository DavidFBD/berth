import { refreshMarks, type MarksRunSummary } from "@/lib/server/marks";
import { fillOrderMarks, type OrderMarksSummary } from "@/lib/server/order-marks";
import { runPortfolioSnapshot, type SnapshotSummary } from "@/lib/server/portfolio";

/**
 * The one evening cron (vercel.json, 22:00 UTC on weekdays; the Hobby plan
 * allows two crons a project, once a day each, and the other is the hold
 * check). Three stages in order, each with its own budget inside the
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
 * A stage that throws or runs out of budget is reported as that and the
 * next one runs. The route answers 500 only when nothing at all was
 * written and something failed.
 */

export const MARKS_BUDGET_MS = 22_000;
export const ORDER_MARKS_BUDGET_MS = 10_000;
/** The snapshot starts no account after this long from the run's start. */
export const SNAPSHOT_DEADLINE_MS = 47_000;

export type Stage<T> = { ok: true; result: T } | { ok: false; error: string };

export type EveningSummary = {
  marks: Stage<MarksRunSummary>;
  orderMarks: Stage<OrderMarksSummary>;
  snapshot: Stage<SnapshotSummary>;
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
  budgets = { marks: MARKS_BUDGET_MS, orderMarks: ORDER_MARKS_BUDGET_MS, snapshotDeadline: SNAPSHOT_DEADLINE_MS },
}: {
  now?: Date;
  marks?: () => Promise<MarksRunSummary>;
  orderMarks?: () => Promise<OrderMarksSummary>;
  snapshot?: (deadline: number) => Promise<SnapshotSummary>;
  budgets?: { marks: number; orderMarks: number; snapshotDeadline: number };
} = {}): Promise<EveningSummary> {
  const started = Date.now();
  const marksStage = await stage(marks, budgets.marks);
  const orderStage = await stage(orderMarks, budgets.orderMarks);
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
  return { marks: marksStage, orderMarks: orderStage, snapshot: snapshotStage, written, failed };
}
