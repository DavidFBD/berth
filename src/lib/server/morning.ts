import { runHoldCheck, type HoldRunSummary } from "@/lib/server/holds";
import { retryPendingSends, deliver, type RetrySummary } from "@/lib/server/email/send";
import { emailBaseUrl } from "@/lib/server/email/config";
import { limitOrdersOn } from "@/lib/server/limit-orders";
import { liveListingPrices } from "@/lib/server/portfolio";
import {
  reminderNotice,
  runRecurringMorning,
  type NewRun,
  type RecurringMorningSummary,
  type RemindOutcome,
} from "@/lib/server/recurring";
import { runWeeklySummaries, type WeeklyRunSummary } from "@/lib/server/weekly";

/**
 * The morning run (vercel.json, 06:00 UTC every day, anywhere in that hour
 * on Hobby: 08:00 in Amsterdam). It was the hold check's cron and is the
 * second of the two Hobby allows. Three stages in order, each with its own
 * budget inside the function's sixty seconds, each run whatever the one
 * before it did:
 *
 * 1. Holds: the thirty day hold check (lib/server/holds).
 * 2. Recurring: runs past three days skipped, and today's runs made, with
 *    one reminder email each (lib/server/recurring). Berth reminds, the
 *    person signs; nothing is bought here.
 * 3. Emails: every notice left pending, sent again (lib/server/email).
 * 4. Weekly: the weekly summary (lib/server/weekly), on Monday, and on
 *    Tuesday and Wednesday for whoever it did not reach, to the people who
 *    switched it on. It runs after the email retry, never beside it, so
 *    the two never share Resend's rate limit and a retried order or
 *    friend notice is never lost to a 429 the summaries caused. Its
 *    budget is whatever the run has left, at most WEEKLY_BUDGET_MS: on a
 *    slow morning it sends fewer, and the rest go the next morning. It
 *    never counts as a failure of the run.
 */

export const HOLDS_BUDGET_MS = 25_000;
export const RECURRING_BUDGET_MS = 20_000;
export const EMAILS_BUDGET_MS = 10_000;
/** The weekly stage's most; it gets less when the stages before it ran long (RUN_BUDGET_MS). */
export const WEEKLY_BUDGET_MS = 10_000;
/** The whole run's time, inside the route's sixty seconds (maxDuration) with room to answer. */
export const RUN_BUDGET_MS = 57_000;
/** It starts nobody new this long before its budget ends: one summary is a few reads, a render and a send. */
export const WEEKLY_MARGIN_MS = 3_000;
/**
 * The recurring stage stops starting new plans and emails this long
 * before its budget runs out, so it answers on its own instead of being
 * raced: one plan is a statement or two, one email a render and a send.
 */
export const RECURRING_MARGIN_MS = 5_000;

export type Stage<T> = { ok: true; result: T } | { ok: false; error: string };

export type MorningSummary = {
  holds: Stage<HoldRunSummary>;
  recurring: Stage<RecurringMorningSummary>;
  emails: Stage<RetrySummary>;
  weekly: Stage<WeeklyRunSummary>;
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

/**
 * One reminder for one new run, deduped by the run's id (email_sends type
 * recurring_due). The switch off, no address, suppressed or already
 * claimed are final; the day's cap, a provider error or sending off leave
 * it open for a retry within the run's life.
 */
export async function remindByEmail(run: NewRun): Promise<RemindOutcome> {
  const outcome = await deliver({ userId: run.userId, ref: run.id, notice: reminderNotice(run, emailBaseUrl()) });
  if (outcome === "sent") return "sent";
  if (outcome === "pref_off" || outcome === "no_address" || outcome === "suppressed" || outcome === "duplicate") return "final";
  return "retry";
}

/** Live prices, read once and only when a dip plan is due; a failed read leaves those runs as ordinary buys. */
export function lazyPrices(read: () => Promise<Record<string, number>> = liveListingPrices): (symbol: string) => Promise<number | undefined> {
  let prices: Promise<Record<string, number>> | undefined;
  return async (symbol) => (await (prices ??= read().catch(() => ({}) as Record<string, number>)))[symbol];
}

export async function runMorning({
  now = new Date(),
  holds = () => runHoldCheck({ now }),
  recurring = () =>
    runRecurringMorning({
      now: now.getTime(),
      deadline: Date.now() + RECURRING_BUDGET_MS - RECURRING_MARGIN_MS,
      priceOf: lazyPrices(),
      limitOn: (user) => limitOrdersOn([user.id, user.wallet]),
      remind: remindByEmail,
    }),
  emails = () => retryPendingSends(),
  weekly = (budgetMs) => runWeeklySummaries({ now, deadline: Date.now() + budgetMs - WEEKLY_MARGIN_MS }),
  budgets = { holds: HOLDS_BUDGET_MS, recurring: RECURRING_BUDGET_MS, emails: EMAILS_BUDGET_MS, weekly: WEEKLY_BUDGET_MS, run: RUN_BUDGET_MS },
  clock = Date.now,
}: {
  now?: Date;
  holds?: () => Promise<HoldRunSummary>;
  recurring?: () => Promise<RecurringMorningSummary>;
  emails?: () => Promise<RetrySummary>;
  /** Given its budget, so it stops starting new summaries in time. */
  weekly?: (budgetMs: number) => Promise<WeeklyRunSummary>;
  budgets?: { holds: number; recurring: number; emails: number; weekly: number; run?: number };
  clock?: () => number;
} = {}): Promise<MorningSummary> {
  const started = clock();
  const holdStage = await stage(holds, budgets.holds);
  const recurringStage = await stage(recurring, budgets.recurring);
  const emailStage = await stage(emails, budgets.emails);
  // After the retry, never beside it; with whatever time the run has left.
  const weeklyBudget = Math.max(0, Math.min(budgets.weekly, (budgets.run ?? RUN_BUDGET_MS) - (clock() - started)));
  const weeklyStage = await stage(() => weekly(weeklyBudget), weeklyBudget);
  if (!holdStage.ok) console.warn("[cron/morning] hold check failed:", holdStage.error);
  if (!recurringStage.ok) console.warn("[cron/morning] recurring failed:", recurringStage.error);
  if (!emailStage.ok) console.warn("[cron/morning] email retry failed:", emailStage.error);
  if (!weeklyStage.ok) console.warn("[cron/morning] weekly summary failed:", weeklyStage.error);
  return { holds: holdStage, recurring: recurringStage, emails: emailStage, weekly: weeklyStage, failed: !holdStage.ok || !recurringStage.ok };
}
