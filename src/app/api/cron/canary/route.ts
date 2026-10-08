import { NextResponse, type NextRequest } from "next/server";
import { checkCronAuth } from "@/lib/server/cron-auth";
import { runCanary } from "@/lib/server/quote-canary";

export const dynamic = "force-dynamic";
/** The quick matrix takes a few seconds; a failing pair is asked again after 20 s. */
export const maxDuration = 60;

/**
 * The quote canary (lib/server/quote-canary). Not a Vercel cron (Hobby
 * allows two, both taken): .github/workflows/quote-canary.yml calls it
 * every 30 minutes in US market hours with `authorization: Bearer
 * $CRON_SECRET`. It answers when the run is done, so the workflow's log
 * shows the verdict; 200 whatever the verdict, since a red canary is news,
 * not a failed request.
 */
export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request.headers.get("authorization"));
  if (!auth.ok) {
    return NextResponse.json({ error: auth.status === 503 ? "cron not configured" : "unauthorized" }, { status: auth.status });
  }
  const summary = await runCanary();
  console.log("[canary]", JSON.stringify(summary));
  return NextResponse.json(summary, { status: 200 });
}
