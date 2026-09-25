import { NextResponse, type NextRequest } from "next/server";
import { checkCronAuth } from "@/lib/server/cron-auth";
import { refreshMarks } from "@/lib/server/marks";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The daily marks (vercel.json, 22:00 UTC on weekdays). A stored mark is
 * the price at 21:30 UTC (lib/marks), after the New York close in either
 * season, so the run waits half an hour past it for DefiLlama to have the
 * point. It writes the last seven days for every listing and benchmark,
 * reading three more behind them for the despike, so a missed day is
 * mended by the next run and a bad mark stored yesterday is taken out
 * today. Idempotent: running it twice writes the same rows.
 */
export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request.headers.get("authorization"));
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.status === 503 ? "cron not configured" : "unauthorized" },
      { status: auth.status },
    );
  }
  const summary = await refreshMarks();
  console.log("[cron/marks]", JSON.stringify(summary));
  return NextResponse.json(summary);
}
