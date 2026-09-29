import type { NextRequest } from "next/server";
import { unlinkWallet, walletsOf } from "@/lib/server/account-wallets";
import { holdingsAt, provedAct, walletsResponse } from "@/lib/server/account-wallets-route";
import { parseTargetKey } from "@/lib/account-proof";

export const dynamic = "force-dynamic";

/**
 * Takes a linked address off the account. Body: { address, message,
 * signature, nonceToken }, the SIWE signed by the home or by the address
 * itself over an "unlink" nonce. The home cannot go (make another home
 * first), nor the address this browser is signed in with. Answers
 * { state: unlinked | is_home | not_linked | signed_in | holds | failed,
 * wallets, signedInWith }. A wallet whose hub wallet still holds listings
 * is not removed (holds); nor is one whose holdings cannot be read (failed).
 * A Solana or Bitcoin address (target `solana:<base58>` or
 * `bitcoin:<address>`, signed by the home or by its own SIWS or SIWB)
 * holds nothing Berth counts: buys land at the home, so it goes without a
 * holdings read.
 */
export async function POST(request: NextRequest) {
  const proved = await provedAct(request, "unlink");
  if (!proved.ok) return proved.response;
  const { family, address } = parseTargetKey(proved.target);
  if (family !== "evm") {
    return walletsResponse(proved.account, { state: await unlinkWallet(proved.account.user.id, address, family) });
  }
  const home = (await walletsOf(proved.account.user.id)).find((wallet) => wallet.family === "evm" && wallet.isHome);
  if (address === home?.address) return walletsResponse(proved.account, { state: "is_home" });
  if (!proved.account.caller.did && proved.account.caller.wallet === address) {
    return walletsResponse(proved.account, { state: "signed_in" });
  }
  // A hub wallet that still holds listings would leave the ledger and the
  // performance line short: it stays until they are sold or moved home.
  // Fails closed when the chain cannot be read.
  const holdings = await holdingsAt(address);
  if (holdings !== "empty") return walletsResponse(proved.account, { state: holdings === "holds" ? "holds" : "failed" });
  const state = await unlinkWallet(proved.account.user.id, address);
  return walletsResponse(proved.account, { state });
}
