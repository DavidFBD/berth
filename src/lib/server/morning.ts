import { runHoldCheck, type HoldRunSummary } from "@/lib/server/holds";
import { runCampaignStep, type CampaignStepSummary } from "@/lib/server/campaigns/eligibility";
import { retryPendingSends, type RetrySummary } from "@/lib/server/email/send";
import { runWeeklySummaries, type WeeklyRunSummary } from "@/lib/server/weekly";
import { runBudgetAlerts, type BudgetAlertSummary } from "@/lib/server/staff/budgets";

/**
 * The morning run (vercel.json, 06:00 UTC every day, anywhere in that hour
 * on Hobby: 08:00 in Amsterdam). It was the hold check's cron and is the
 * second of the two Hobby allows. Its stages run in order, each with its
 * own budget inside the function's sixty seconds, each run whatever the
 * one before it did:
 *
 * 1. Holds: the thirty day hold check (lib/server/holds), then the
 *    campaign step inside the same stage's turn (lib/server/campaigns
 *    eligibility): open claims advanced, and holding claims that are due
 *    judged, holding to qualified. Never a payment: staff approve and
 *    David pays by hand. Its own budget; a failure is logged and never
 *    fails the run (it pays nobody, so tomorrow's step loses nothing).
 * 2. Emails: every notice left pending, sent again (lib/server/email).
 * 3. Weekly: the weekly summary (lib/server/weekly), on Monday, and on
 *    Tuesday to Thursday for whoever it did not reach, to the people who
 *    switched it on. It runs after the email retry, never beside it, so
 *    the two never share Resend's rate limit and a retried order or
 *    friend notice is never lost to a 429 the summaries caused. Its
 *    budget is whatever the run has left, at most WEEKLY_BUDGET_MS: on a
 *    slow morning it sends fewer, and the rest go the next morning. It
 *    never counts as a failure of the run.
 * 4. Budgets: when a paid service runs low (lib/server/staff/budgets), one
 *    email to each staff admin, once per service a day. Last, in at most
 *    BUDGET_ALERTS_BUDGET_MS of what the run has left (the weekly stage
 *    leaves it that room); a few reads and a handful of sends at most;
 *    never a failure of the run.
 *
 * Until 2026-10-04 a recurring stage ran between holds and emails, making
 * the day's recurring buy reminders. Recurring buys were retired then
 * (docs/adr/0007): the run no longer reads recurring_plans or
 * recurring_runs, and sends no reminder.
 */

export const HOLDS_BUDGET_MS = 18_000;
/** The campaign step's most, taken from the holds' turn: hold windows read on Sonic, four at a time, then the open claims while time is left. */
/** The hold check stops judging new buys this long before its budget ends, so it answers on its own. */
export const HOLDS_MARGIN_MS = 2_000;
export const CAMPAIGNS_BUDGET_MS = 8_000;
export const EMAILS_BUDGET_MS = 10_000;
/** The weekly stage's most; it gets less when the stages before it ran long (RUN_BUDGET_MS). */
export const WEEKLY_BUDGET_MS = 10_000;
/** The budget alert stage: a few sums and, on a bad day, a few security notices. */
export const BUDGET_ALERTS_BUDGET_MS = 4_000;
/** The whole run's time, inside the route's sixty seconds (maxDuration) with room to answer. */
export const RUN_BUDGET_MS = 57_000;
/** It starts nobody new this long before its budget ends: one summary is a few reads, a render and a send. */
export const WEEKLY_MARGIN_MS = 3_000;

export type Stage<T> = { ok: true; result: T } | { ok: false; error: string };

export type MorningSummary = {
  holds: Stage<HoldRunSummary>;
  campaigns: Stage<CampaignStepSummary>;
  emails: Stage<RetrySummary>;
  weekly: Stage<WeeklyRunSummary>;
  budgets: Stage<BudgetAlertSummary>;
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

export async function runMorning({
  now = new Date(),
  holds = () => runHoldCheck({ now, deadline: Date.now() + HOLDS_BUDGET_MS - HOLDS_MARGIN_MS }),
  campaigns = () => runCampaignStep({ now, deadline: Date.now() + CAMPAIGNS_BUDGET_MS - 1_500 }),
  emails = () => retryPendingSends(),
  weekly = (budgetMs) => runWeeklySummaries({ now, deadline: Date.now() + budgetMs - WEEKLY_MARGIN_MS }),
  budgetAlerts = () => runBudgetAlerts({ now }),
  budgets = { holds: HOLDS_BUDGET_MS, emails: EMAILS_BUDGET_MS, weekly: WEEKLY_BUDGET_MS, run: RUN_BUDGET_MS },
  clock = Date.now,
}: {
  now?: Date;
  holds?: () => Promise<HoldRunSummary>;
  campaigns?: () => Promise<CampaignStepSummary>;
  emails?: () => Promise<RetrySummary>;
  /** Given its budget, so it stops starting new summaries in time. */
  weekly?: (budgetMs: number) => Promise<WeeklyRunSummary>;
  budgetAlerts?: () => Promise<BudgetAlertSummary>;
  budgets?: { holds: number; campaigns?: number; emails: number; weekly: number; run?: number };
  clock?: () => number;
} = {}): Promise<MorningSummary> {
  const started = clock();
  const holdStage = await stage(holds, budgets.holds);
  const campaignStage = await stage(campaigns, budgets.campaigns ?? CAMPAIGNS_BUDGET_MS);
  const emailStage = await stage(emails, budgets.emails);
  // After the retry, never beside it; with whatever time the run has left,
  // less the budget alerts' share, which come last.
  const run = budgets.run ?? RUN_BUDGET_MS;
  const weeklyBudget = Math.max(0, Math.min(budgets.weekly, run - (clock() - started) - BUDGET_ALERTS_BUDGET_MS));
  // No time at all: the weekly stage is not started (not even its reads); the summaries go another morning.
  const weeklyStage: Stage<WeeklyRunSummary> =
    weeklyBudget > 0 ? await stage(() => weekly(weeklyBudget), weeklyBudget) : { ok: false, error: "no time left" };
  // Last, in what is left of the run (never past it), so recording the run
  // still fits inside the function's sixty seconds.
  const budgetAlertsBudget = Math.max(0, Math.min(BUDGET_ALERTS_BUDGET_MS, run - (clock() - started)));
  const budgetStage: Stage<BudgetAlertSummary> =
    budgetAlertsBudget > 0 ? await stage(budgetAlerts, budgetAlertsBudget) : { ok: false, error: "no time left" };
  if (!holdStage.ok) console.warn("[cron/morning] hold check failed:", holdStage.error);
  if (!campaignStage.ok) console.warn("[cron/morning] campaign step failed:", campaignStage.error);
  if (!emailStage.ok) console.warn("[cron/morning] email retry failed:", emailStage.error);
  if (!weeklyStage.ok) console.warn("[cron/morning] weekly summary failed:", weeklyStage.error);
  if (!budgetStage.ok) console.warn("[cron/morning] budget alerts failed:", budgetStage.error);
  return { holds: holdStage, campaigns: campaignStage, emails: emailStage, weekly: weeklyStage, budgets: budgetStage, failed: !holdStage.ok };
}
