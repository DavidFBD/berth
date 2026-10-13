import { after, NextResponse, type NextRequest } from "next/server";
import { checkCronAuth } from "@/lib/server/cron-auth";
import { claimNewsSlot } from "@/lib/server/news-store";
import { runClaimed } from "@/lib/server/news-read";
import { utcDay } from "@/lib/x-schedule";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The news store's cron run, in a function of its own. Not a third cron
 * (Hobby allows two): the morning cron calls this first
 * (lib/server/news-kick) and go on with their own work, so their budgets
 * are untouched. 202 at once, then the run in `after()` inside this
 * function's own sixty seconds. One run per phase per UTC day, claimed.
 */
export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request.headers.get("authorization"));
  if (!auth.ok) {
    return NextResponse.json({ error: auth.status === 503 ? "cron not configured" : "unauthorized" }, { status: auth.status });
  }
  const phase = request.nextUrl.searchParams.get("phase") === "morning" ? "morning" : "evening";
  const claim = `cron:${phase}:${utcDay(Date.now())}`;
  const claimed = await claimNewsSlot("ingest", claim, Date.now(), {
    retryAfterMs: 5 * 60 * 1000,
    staleMs: 2 * 60 * 1000,
    maxAttempts: 2,
  }).catch((error: unknown) => {
    console.error("[news] cron claim failed", error instanceof Error ? error.name : "error");
    return "error" as const;
  });
  if (claimed === "error") return NextResponse.json({ phase, started: false, error: "store unavailable" }, { status: 503 });
  if (!claimed) return NextResponse.json({ phase, started: false }, { status: 200 });
  after(() => runClaimed(claim, phase));
  return NextResponse.json({ phase, started: true }, { status: 202 });
}
