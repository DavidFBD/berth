import type { NextRequest } from "next/server";
import { makeHome } from "@/lib/server/account-wallets";
import { provedAct, walletsResponse } from "@/lib/server/account-wallets-route";

export const dynamic = "force-dynamic";

/**
 * Makes a linked address the home: future buys land in its hub wallet,
 * nothing already bought moves. Body: { address, message, signature,
 * nonceToken }, the SIWE signed by the CURRENT home over a "home" nonce
 * issued for this address (an account with no home: a fresh email proof),
 * so a borrowed session alone can never send someone's buys elsewhere.
 * Answers { state: home | already | not_linked, wallets, signedInWith }.
 */
export async function POST(request: NextRequest) {
  const proved = await provedAct(request, "home");
  if (!proved.ok) return proved.response;
  const state = await makeHome(proved.account.user.id, proved.target);
  return walletsResponse(proved.account, { state });
}
