import type { NextRequest } from "next/server";
import { accountForWallet } from "@/lib/server/accounts";
import { linkWallet } from "@/lib/server/account-wallets";
import { provedAct, walletsResponse } from "@/lib/server/account-wallets-route";
import { offerView } from "@/lib/server/account-merge-route";
import { parseTargetKey } from "@/lib/account-proof";
import { issueWalletSession } from "@/lib/server/wallet-session";

export const dynamic = "force-dynamic";

/**
 * Links the address that signed the proof to the caller's account.
 * Body: { message, signature, nonceToken, accountProof? }: the new address's
 * SIWE (a Solana address: its SIWS, signature base58; a Bitcoin address:
 * its SIWB, signature base64 BIP-322 or BIP-137) over a "link" nonce
 * issued for it, and the account's own
 * confirmation (its home's SIWE over the same nonce, or for an email
 * account a code entered in the last ten minutes; else 403 "sign in again").
 * Answers { state, wallets, signedInWith, walletSession?, merge? }: `state`
 * is linked, already, other_account or cooling, and only ever reaches the
 * address's proven owner. A linked EVM address gets its own wallet session,
 * so the browser can later sign in with it without a second signature. A
 * Solana or Bitcoin address never does: sign in is EVM or email. An EVM address on
 * another account comes with `merge`, the offer to make the two accounts
 * one (lib/server/account-merge-route): both were just proved. A Solana
 * or Bitcoin one never does.
 */
export async function POST(request: NextRequest) {
  const proved = await provedAct(request, "link");
  if (!proved.ok) return proved.response;
  const { family, address } = parseTargetKey(proved.signer);
  const state = await linkWallet(proved.account.user.id, address, family);
  const walletSession =
    family === "evm" && (state === "linked" || state === "already") ? await issueWalletSession(address) : undefined;
  let merge = undefined;
  // Only a proof that can sign in may join two accounts: an EVM wallet's
  // SIWE (the account's own side is its home's SIWE or a fresh email code,
  // provedAct). A Solana or Bitcoin signature proves the address but opens nothing.
  if (state === "other_account" && family === "evm") {
    const other = await accountForWallet(address);
    if (other) merge = (await offerView(proved.account.user.id, other.id, "wallet", address)) ?? undefined;
  }
  return walletsResponse(proved.account, { state, address, family, walletSession, merge });
}
