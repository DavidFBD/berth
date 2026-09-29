import { NextResponse, type NextRequest } from "next/server";
import { callerKey } from "@/lib/server/oauth/http";
import { readRewardsCaller, resolveRewardsUser } from "@/lib/server/rewards-route";
import { PUBLIC_OPS, runSocialOp } from "@/lib/server/social/ops";

export const dynamic = "force-dynamic";

/**
 * Every social request (lib/server/social/ops), POST like every rewards
 * call. The account comes from the rewards prologue, never from the body.
 * A request with no proof of anyone may ask for a card and is told to sign
 * in, the same for every name; a request with a bad proof is refused as
 * everywhere else.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ op: string }> }) {
  const { op } = await params;
  const anonymous = !request.headers.get("authorization") && !request.headers.get("x-wallet-session");
  let viewer = null;
  let body: Record<string, unknown>;
  if (anonymous && PUBLIC_OPS.has(op)) {
    body = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  } else {
    const read = await readRewardsCaller(request);
    if (!read.ok) return read.response;
    const resolved = await resolveRewardsUser(read.caller);
    if (!resolved.ok) return resolved.response;
    viewer = { id: resolved.user.id, email: resolved.user.email };
    body = read.caller.body;
  }
  const result = await runSocialOp(op, body, { viewer, anonKey: callerKey(request) });
  return NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
}
