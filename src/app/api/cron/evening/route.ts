import { NextResponse, type NextRequest } from "next/server";
import { checkCronAuth } from "@/lib/server/cron-auth";
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
  const summary = await runEvening();
  console.log("[cron/evening]", JSON.stringify(summary));
  return NextResponse.json(summary, { status: summary.written === 0 && summary.failed ? 500 : 200 });
}
