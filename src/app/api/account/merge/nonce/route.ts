import type { NextRequest } from "next/server";
import { refuseSanctioned } from "@/lib/server/availability";
import { mergeNonce } from "@/lib/server/account-merge-route";

export const dynamic = "force-dynamic";

/** A ten minute nonce for a wallet's merge signature, to a Privy DID with a fresh email code (lib/server/account-merge-route). */
export async function POST(request: NextRequest) {
  // No account is served from a comprehensively sanctioned place (lib/server/availability).
  return refuseSanctioned(request.headers, request.url) ?? mergeNonce(request);
}
