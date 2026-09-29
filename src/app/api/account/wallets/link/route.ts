import type { NextRequest } from "next/server";
import { linkWallet } from "@/lib/server/account-wallets";
import { provedAct, walletsResponse } from "@/lib/server/account-wallets-route";
import { parseTargetKey } from "@/lib/account-proof";
import { issueWalletSession } from "@/lib/server/wallet-session";

export const dynamic = "force-dynamic";

/**
 * Links the address that signed the proof to the caller's account.
 * Body: { message, signature, nonceToken, accountProof? }: the new address's
 * SIWE (a Solana address: its SIWS, signature base58) over a "link" nonce
 * issued for it, and the account's own
 * confirmation (its home's SIWE over the same nonce, or for an email
 * account a code entered in the last ten minutes; else 403 "sign in again").
 * Answers { state, wallets, signedInWith, walletSession? }: `state` is
 * linked, already, other_account or cooling, and only ever reaches the
 * address's proven owner. A linked EVM address gets its own wallet session,
 * so the browser can later sign in with it without a second signature. A
 * Solana address never does: sign in is EVM or email.
 */
export async function POST(request: NextRequest) {
  const proved = await provedAct(request, "link");
  if (!proved.ok) return proved.response;
  const { family, address } = parseTargetKey(proved.signer);
  const state = await linkWallet(proved.account.user.id, address, family);
  const walletSession =
    family === "evm" && (state === "linked" || state === "already") ? await issueWalletSession(address) : undefined;
  return walletsResponse(proved.account, { state, address, family, walletSession });
}
