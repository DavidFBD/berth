import { NextResponse, type NextRequest } from "next/server";
import { limitOrdersOn } from "@/lib/server/limit-orders";
import { lazyPrices } from "@/lib/server/morning";
import { readRewardsCaller, refuseWhereUnavailable, resolveRewardsUser } from "@/lib/server/rewards-route";
import {
  ageRuns,
  createPlan,
  deletePlan,
  listPlans,
  makeDueRuns,
  openRun,
  readyRuns,
  setPaused,
  skipRun,
  updatePlan,
} from "@/lib/server/recurring";
import { RECURRING_ID, checkPlan, type PlanInput, type RecurringResponse } from "@/lib/recurring";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Recurring buys for the signed-in account (lib/server/recurring,
 * docs/adr/0007). Berth reminds, the person signs: nothing here places an
 * order. One POST, an action each:
 *
 *   { action: "list" }                       plans, the runs ready now, and whether dip plans are open
 *   { action: "create", plan }               at most ten plans, $1 to $10,000
 *   { action: "update", planId, plan }
 *   { action: "pause" | "resume", planId }
 *   { action: "delete", planId }
 *   { action: "open" | "skip", runId }       the person opened a run's draft, or let it pass
 *
 * A list also makes any run whose day has already started in the plan's
 * zone (the morning run sends the email; this only shows the strip), and
 * skips runs past their three days. Same proof of identity as the rewards
 * routes: a Privy token or a wallet session.
 */

function planInput(value: unknown): PlanInput | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  return {
    listing: typeof raw.listing === "string" ? raw.listing : "",
    usd: Number(raw.usd),
    cadence: raw.cadence === "monthly" ? "monthly" : raw.cadence === "weekly" ? "weekly" : ("" as never),
    weekday: raw.weekday === undefined || raw.weekday === null ? null : Number(raw.weekday),
    monthDay: raw.monthDay === undefined || raw.monthDay === null ? null : Number(raw.monthDay),
    timeZone: typeof raw.timeZone === "string" ? raw.timeZone : "",
    orderType: raw.orderType === "limit" ? "limit" : "market",
    dipPct: raw.dipPct === undefined || raw.dipPct === null ? null : Number(raw.dipPct),
  };
}

export async function POST(request: NextRequest) {
  const read = await readRewardsCaller(request);
  if (!read.ok) return read.response;
  const resolved = await resolveRewardsUser(read.caller);
  if (!resolved.ok) return resolved.response;
  const { user } = resolved;
  const { body } = read.caller;
  const limitAllowed = limitOrdersOn([user.id, user.wallet_address, read.caller.wallet]);
  const action = body.action ?? "list";
  const planId = typeof body.planId === "string" ? body.planId : "";
  const runId = typeof body.runId === "string" ? body.runId : "";

  const answer = async () => {
    const now = Date.now();
    await ageRuns(now, user.id);
    // Dip plans need a price, read only when one is due, and only accounts with limit orders have them.
    await makeDueRuns({
      cutoff: now,
      userId: user.id,
      priceOf: lazyPrices(),
      limitOn: () => limitAllowed,
    }).catch((error) => {
      console.warn("[recurring] runs not made", error instanceof Error ? error.message : error);
      return [];
    });
    const [plans, ready] = await Promise.all([listPlans(user.id), readyRuns(user.id)]);
    return NextResponse.json({ plans, ready, limitAllowed } satisfies RecurringResponse);
  };

  if (action === "list") return answer();

  // Where Berth is not available no plan is made, changed or resumed
  // (lib/availability). Pausing, deleting and letting a run pass always work.
  if (action === "create" || action === "update" || action === "resume") {
    const refused = refuseWhereUnavailable(read.caller);
    if (refused) return refused;
  }

  // A plan or run id that is not a uuid is a bad request, never a database error.
  const needsPlan = action === "update" || action === "pause" || action === "resume" || action === "delete";
  const needsRun = action === "open" || action === "skip";
  if ((needsPlan && !RECURRING_ID.test(planId)) || (needsRun && !RECURRING_ID.test(runId))) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }

  if (action === "create" || action === "update") {
    const input = planInput(body.plan);
    if (!input) return NextResponse.json({ error: "bad plan" }, { status: 400 });
    const checked = checkPlan(input, { limitAllowed });
    if (!checked.ok) return NextResponse.json({ error: checked.reason }, { status: 422 });
    if (action === "create") {
      const created = await createPlan(user.id, checked.plan, { via: body.via === "assistant" ? "assistant" : "app" });
      if (created === "too_many") return NextResponse.json({ error: "too_many" }, { status: 409 });
    } else {
      const updated = await updatePlan(user.id, planId, checked.plan);
      if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return answer();
  }

  if (action === "pause" || action === "resume") {
    const done = await setPaused(user.id, planId, action === "pause");
    if (!done) return NextResponse.json({ error: "not found" }, { status: 404 });
    // An account merge can leave more than ten plans, the extras paused: at most ten run.
    if (done === "too_many") return NextResponse.json({ error: "too_many" }, { status: 409 });
    return answer();
  }

  if (action === "delete") {
    if (!(await deletePlan(user.id, planId))) return NextResponse.json({ error: "not found" }, { status: 404 });
    return answer();
  }

  if (action === "open" || action === "skip") {
    const status = action === "open" ? await openRun(user.id, runId) : await skipRun(user.id, runId);
    if (!status) return NextResponse.json({ error: "not found" }, { status: 404 });
    return answer();
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
