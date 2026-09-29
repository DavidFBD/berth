import type { NextRequest } from "next/server";
import { issueNonce } from "@/lib/server/account-wallets-route";

export const dynamic = "force-dynamic";

/** A ten minute nonce for one wallet act on the caller's account (lib/server/account-wallets-route). */
export async function POST(request: NextRequest) {
  return issueNonce(request);
}
