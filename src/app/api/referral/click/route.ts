import { NextResponse, type NextRequest } from "next/server";
import {
  normalizeReferralCode,
  recordReferralClick,
} from "@/lib/server/accounts";

/**
 * Funnel telemetry beacon from the /r/CODE landing: one row per tap, no
 * auth (the visitor has no account yet, that's the point), no XP, and junk
 * codes never make a row. Always answers 204 — a landing page must not care.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const code = normalizeReferralCode(body.code);
  if (code) {
    try {
      await recordReferralClick(code);
    } catch {
      // Telemetry never breaks a landing.
    }
  }
  return new NextResponse(null, { status: 204 });
}
