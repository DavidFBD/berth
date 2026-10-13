import { NextResponse, type NextRequest } from "next/server";
import { checkCronAuth } from "@/lib/server/cron-auth";
import { recordCronRun } from "@/lib/server/cron-runs";
import { runEvening } from "@/lib/server/evening";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The evening run (vercel.json, 22:00 UTC on weekdays): the day's marks,
 * the order-minute benchmark prices still missing, then every account's
 * snapshot, in that order and each within its own budget
 * (lib/server/evening). 200 with the counts per stage; 500 only when
 * nothing at all was written and something failed.
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
  // News is gathered once a day, from the morning run (app/api/cron/morning),
  // and through the day by the column's own slots (lib/server/news-read).
  const summary = await runEvening();
  console.log("[cron/evening]", JSON.stringify(summary));
  // The staff Health page reads it back (lib/server/cron-runs).
  await recordCronRun("evening", startedAt, !summary.failed, summary);
  return NextResponse.json(summary, { status: summary.written === 0 && summary.failed ? 500 : 200 });
}
