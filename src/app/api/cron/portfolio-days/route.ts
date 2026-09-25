import { NextResponse, type NextRequest } from "next/server";
import { checkCronAuth } from "@/lib/server/cron-auth";
import { runPortfolioSnapshot } from "@/lib/server/portfolio";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Today's value for every account (vercel.json, 23:00 UTC on weekdays, an
 * hour after the marks: Vercel may fire a daily cron anywhere in its hour,
 * so the gap keeps this run after the marks are stored, and a run that
 * lands after midnight UTC still counts as the evening's; lib/portfolio-
 * days snapshotDay).
 * Balances read on chain, so a transfer the orders never saw still counts;
 * the rules and the IO are in lib/server/portfolio.
 */
export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request.headers.get("authorization"));
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.status === 503 ? "cron not configured" : "unauthorized" },
      { status: auth.status },
    );
  }
  const summary = await runPortfolioSnapshot();
  console.log("[cron/portfolio-days]", JSON.stringify(summary));
  return NextResponse.json(summary);
}
