import { NextResponse, type NextRequest } from "next/server";
import { refuseSanctioned } from "@/lib/server/availability";
import { generateSiweNonce } from "viem/siwe";
import { issueNonceToken } from "@/lib/server/wallet-session";

/**
 * First half of the SIWE handshake: a fresh nonce plus a signed 10-minute
 * token binding it, so verification stays stateless (no nonce table).
 */
export async function POST(request: NextRequest) {
  // No sign in from a comprehensively sanctioned place (lib/server/availability).
  const refused = refuseSanctioned(request.headers, request.url);
  if (refused) return refused;
  const nonce = generateSiweNonce();
  return NextResponse.json({ nonce, nonceToken: await issueNonceToken(nonce) });
}
