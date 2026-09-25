import { NextResponse, type NextRequest } from "next/server";
import { checkCronAuth } from "@/lib/server/cron-auth";
import { refreshMarks } from "@/lib/server/marks";
import { fillOrderMarks, type OrderMarksSummary } from "@/lib/server/order-marks";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The daily marks (vercel.json, 22:00 UTC on weekdays). A stored mark is
 * the price at 21:30 UTC (lib/marks), after the New York close in either
 * season, so the run waits half an hour past it for DefiLlama to have the
 * point. It writes the last seven days for every listing and benchmark,
 * reading three more behind them for the despike, so a missed day is
 * mended by the next run and a bad mark stored yesterday is taken out
 * today; a portfolio day valued at a mark that changed or went is re-valued
 * (lib/server/marks revalueDays). Then it fills in the benchmark prices at
 * the order's minute (table `order_marks`) for up to fifty orders still
 * missing one. Idempotent: running it twice writes the same rows.
 *
 * 500 when nothing at all was written and something failed, so a run that
 * did nothing but fail shows as failed; 200 with the counts otherwise.
 */
export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request.headers.get("authorization"));
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.status === 503 ? "cron not configured" : "unauthorized" },
      { status: auth.status },
    );
  }
  const marks = await refreshMarks();
  let orderMarks: OrderMarksSummary | { error: string };
  try {
    orderMarks = await fillOrderMarks();
  } catch (error) {
    orderMarks = { error: error instanceof Error ? error.message : "order marks failed" };
  }
  const summary = { ...marks, orderMarks };
  console.log("[cron/marks]", JSON.stringify(summary));
  const wrote = marks.written + marks.dropped + ("written" in orderMarks ? orderMarks.written : 0);
  const failed =
    marks.failures.length > 0 || "error" in orderMarks || orderMarks.failed > 0;
  return NextResponse.json(summary, { status: wrote === 0 && failed ? 500 : 200 });
}
