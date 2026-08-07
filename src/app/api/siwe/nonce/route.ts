import { NextResponse } from "next/server";
import { generateSiweNonce } from "viem/siwe";
import { issueNonceToken } from "@/lib/server/wallet-session";

/**
 * First half of the SIWE handshake: a fresh nonce plus a signed 10-minute
 * token binding it, so verification stays stateless (no nonce table).
 */
export async function POST() {
  const nonce = generateSiweNonce();
  return NextResponse.json({ nonce, nonceToken: await issueNonceToken(nonce) });
}
