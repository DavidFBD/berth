import { NextResponse, type NextRequest } from "next/server";
import { checkCronAuth } from "@/lib/server/cron-auth";
import { recordCronRun } from "@/lib/server/cron-runs";
import { startNewsKick } from "@/lib/server/news-kick";
import { runMorning } from "@/lib/server/morning";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The morning run (vercel.json, 06:00 UTC every day): the thirty day hold
 * check and the campaign step, the email notices left pending, then the
 * weekly summary on its mornings, and the budget alerts, in that order and
 * each within its own budget (lib/server/morning). Each stage's summary
 * either way; 500 when the hold check failed, so Vercel's cron log shows
 * it, even though every stage still ran.
 */
export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request.headers.get("authorization"));
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.status === 503 ? "cron not configured" : "unauthorized" },
      { status: auth.status },
    );
  }
  const startedAt = new Date();
  // The news store runs beside this, in its own function (app/api/cron/news):
  // started, not awaited, so this run keeps its whole budget.
  const kick = startNewsKick(request, "morning");
  const summary = await runMorning();
  const news = await kick;
  console.log("[cron/morning]", JSON.stringify({ ...summary, news }));
  // The staff Health page reads it back (lib/server/cron-runs).
  await recordCronRun("morning", startedAt, !summary.failed, summary);
  return NextResponse.json(summary, { status: summary.failed ? 500 : 200 });
}
