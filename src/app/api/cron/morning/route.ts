import { NextResponse, type NextRequest } from "next/server";
import { checkCronAuth } from "@/lib/server/cron-auth";
import { runMorning } from "@/lib/server/morning";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The morning run (vercel.json, 06:00 UTC every day): the thirty day hold
 * check, the recurring buys' reminders, and the email notices left
 * pending, then on Monday to Wednesday the weekly summary, in that order
 * and each within its own budget
 * (lib/server/morning). Each stage's summary either way; 500 when the hold
 * check or the recurring stage failed, so Vercel's cron log shows it, even
 * though every stage still ran.
 */
export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request.headers.get("authorization"));
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.status === 503 ? "cron not configured" : "unauthorized" },
      { status: auth.status },
    );
  }
  const summary = await runMorning();
  console.log("[cron/morning]", JSON.stringify(summary));
  return NextResponse.json(summary, { status: summary.failed ? 500 : 200 });
}
