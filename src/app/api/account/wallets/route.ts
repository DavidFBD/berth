import type { NextRequest } from "next/server";
import { accountOf, walletsResponse } from "@/lib/server/account-wallets-route";

export type { WalletsResponse, WalletView } from "@/lib/server/account-wallets-route";

export const dynamic = "force-dynamic";

/**
 * The wallets linked to the caller's account, home first (the account
 * drawer's Wallets list). Same proof of identity as every rewards route.
 */
export async function POST(request: NextRequest) {
  const got = await accountOf(request);
  if (!got.ok) return got.response;
  return walletsResponse(got.account);
}
