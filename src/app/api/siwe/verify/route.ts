import { NextResponse, type NextRequest } from "next/server";
import { verifySiwe } from "@/lib/server/siwe";
import { refuseSanctioned } from "@/lib/server/availability";
import {
  issueWalletSession,
  readNonceToken,
} from "@/lib/server/wallet-session";

/**
 * Second half of the SIWE handshake: check the signed message against the
 * nonce we issued and the signature against the key (lib/server/siwe: an
 * ordinary key locally, ERC-1271 and ERC-6492 accounts on chain), then mint
 * the wallet session the rewards routes now require from wallet-only
 * callers.
 */
export async function POST(request: NextRequest) {
  // No sign in from a comprehensively sanctioned place (lib/server/availability).
  const refused = refuseSanctioned(request.headers, request.url);
  if (refused) return refused;
  const body = (await request.json().catch(() => ({}))) as {
    message?: unknown;
    signature?: unknown;
    nonceToken?: unknown;
  };
  if (
    typeof body.message !== "string" ||
    typeof body.signature !== "string" ||
    typeof body.nonceToken !== "string"
  ) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const nonce = await readNonceToken(body.nonceToken);
  if (!nonce) {
    return NextResponse.json({ error: "stale nonce" }, { status: 401 });
  }

  const walletAddress = await verifySiwe({ message: body.message, signature: body.signature, nonce });
  if (!walletAddress) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  return NextResponse.json({
    sessionToken: await issueWalletSession(walletAddress),
    walletAddress,
  });
}
