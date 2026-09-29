import type { NextRequest } from "next/server";
import { linkWallet } from "@/lib/server/account-wallets";
import { provedAct, walletsResponse } from "@/lib/server/account-wallets-route";
import { issueWalletSession } from "@/lib/server/wallet-session";

export const dynamic = "force-dynamic";

/**
 * Links the EVM address that signed the proof to the caller's account.
 * Body: { message, signature, nonceToken, accountProof? }: the new address's
 * SIWE over a "link" nonce issued for it, and the account's own
 * confirmation (its home's SIWE over the same nonce, or for an email
 * account a code entered in the last ten minutes; else 403 "sign in again").
 * Answers { state, wallets, signedInWith, walletSession? }: `state` is
 * linked, already, other_account or cooling, and only ever reaches the
 * address's proven owner. A linked address gets its own wallet session, so
 * the browser can later sign in with it without a second signature.
 */
export async function POST(request: NextRequest) {
  const proved = await provedAct(request, "link");
  if (!proved.ok) return proved.response;
  const state = await linkWallet(proved.account.user.id, proved.signer);
  const walletSession = state === "linked" || state === "already" ? await issueWalletSession(proved.signer) : undefined;
  return walletsResponse(proved.account, { state, address: proved.signer, walletSession });
}
