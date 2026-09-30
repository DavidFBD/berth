import type { NextRequest } from "next/server";
import { refuseSanctioned } from "@/lib/server/availability";
import { emailOffer } from "@/lib/server/account-merge-route";

export const dynamic = "force-dynamic";

/**
 * The merge offer for an email that already has a Berth account: the email
 * account's Privy token (its code entered in the last ten minutes) and the
 * wallet's signature over a merge nonce, made now
 * (lib/server/account-merge-route).
 */
export async function POST(request: NextRequest) {
  // No account is served from a comprehensively sanctioned place (lib/server/availability).
  return refuseSanctioned(request.headers, request.url) ?? emailOffer(request);
}
