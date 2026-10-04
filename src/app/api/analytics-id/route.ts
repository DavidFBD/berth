import { NextResponse, type NextRequest } from "next/server";
import { readRewardsCaller } from "@/lib/server/rewards-route";
import { analyticsIdOf } from "@/lib/server/analytics-id";

/**
 * The caller's analytics name (lib/server/analytics-id), asked for only
 * after the person allowed analytics (components/analytics/analytics-root).
 * Read only: it never creates an account. `{ id: null }` when there is no
 * account yet or no salt is configured; 429 past the hourly limit.
 */
export async function POST(request: NextRequest) {
  const read = await readRewardsCaller(request);
  if (!read.ok) return read.response;
  const answer = await analyticsIdOf({ did: read.caller.did, wallet: read.caller.wallet });
  if (!answer.ok) return NextResponse.json({ error: "slow_down" }, { status: answer.status });
  return NextResponse.json({ id: answer.id }, { headers: { "cache-control": "no-store" } });
}
