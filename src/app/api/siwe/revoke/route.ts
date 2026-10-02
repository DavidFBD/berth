import { NextResponse, type NextRequest } from "next/server";
import { MAX_REVOKE, revokeWalletSessions } from "@/lib/server/wallet-session-revocations";
import { takeRatePlace } from "@/lib/server/oauth/rate-limit";
import { callerKey } from "@/lib/server/oauth/http";

/** Sign outs per address an hour: a person signs out a handful of times, a flood does not get to write. */
export const REVOKE_LIMIT_PER_HOUR = 30;

/**
 * Sign out, on the server: the browser sends the wallet session tokens it
 * holds and each one stops working everywhere (lib/server/wallet-session-
 * revocations). Holding a token is the authority to end it, so this asks
 * for nothing else. Never refused for place: leaving must always work.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { tokens?: unknown };
  if (!Array.isArray(body.tokens) || body.tokens.length > MAX_REVOKE) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  try {
    if (!(await takeRatePlace("wallet-revoke", callerKey(request), REVOKE_LIMIT_PER_HOUR))) {
      return NextResponse.json({ error: "slow down" }, { status: 429 });
    }
    return NextResponse.json({ revoked: await revokeWalletSessions(body.tokens) });
  } catch (error) {
    console.error("[wallet-session] revoke failed", error);
    return NextResponse.json({ error: "revoke failed" }, { status: 503 });
  }
}
