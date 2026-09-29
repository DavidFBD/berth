import { NextResponse, type NextRequest } from "next/server";
import { checkCronAuth } from "@/lib/server/cron-auth";
import { runHoldCheck } from "@/lib/server/holds";
import { retryPendingSends } from "@/lib/server/email/send";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The daily thirty day hold check (vercel.json, 06:00 UTC). The rule and
 * everything it touches live in lib/server/holds; this route is the door
 * and the summary. It is also the morning pass for email notices left
 * pending (lib/server/email), the evening cron being the other.
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
  const emails = await retryPendingSends().catch((error: unknown) => {
    console.warn("[cron/held] email retry failed:", error instanceof Error ? error.name : "error");
    return null;
  });
  return NextResponse.json({ ...summary, emails });
}
