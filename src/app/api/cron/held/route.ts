import { NextResponse, type NextRequest } from "next/server";
import { checkCronAuth } from "@/lib/server/cron-auth";
import { runHoldCheck } from "@/lib/server/holds";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The daily thirty day hold check (vercel.json, 06:00 UTC). The rule and
 * everything it touches live in lib/server/holds; this route is the door
 * and the summary.
 */
export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request.headers.get("authorization"));
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.status === 503 ? "cron not configured" : "unauthorized" },
      { status: auth.status },
    );
  }
  const summary = await runHoldCheck();
  return NextResponse.json(summary);
}
