import type { NextRequest } from "next/server";
import { mergeNonce } from "@/lib/server/account-merge-route";

export const dynamic = "force-dynamic";

/** A ten minute nonce for a wallet's merge signature, to a Privy DID with a fresh email code (lib/server/account-merge-route). */
export async function POST(request: NextRequest) {
  return mergeNonce(request);
}
