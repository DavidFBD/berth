import { NextResponse, type NextRequest } from "next/server";
import { createPublicClient, http } from "viem";
import { sonic } from "viem/chains";
import { parseSiweMessage, validateSiweMessage } from "viem/siwe";
import {
  issueWalletSession,
  readNonceToken,
} from "@/lib/server/wallet-session";

/**
 * Second half of the SIWE handshake: check the signed message against the
 * nonce we issued and the signature against the chain (public-client
 * verifyMessage handles EOAs, ERC-1271 smart accounts, and ERC-6492
 * pre-deploy accounts alike), then mint the wallet session the rewards
 * routes now require from wallet-only callers.
 */

const client = createPublicClient({
  chain: sonic,
  transport: http("https://sonic-rpc.publicnode.com"),
});

export async function POST(request: NextRequest) {
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

  const fields = parseSiweMessage(body.message);
  if (
    !fields.address ||
    !validateSiweMessage({ message: fields, nonce })
  ) {
    return NextResponse.json({ error: "invalid message" }, { status: 401 });
  }

  const valid = await client
    .verifyMessage({
      address: fields.address,
      message: body.message,
      signature: body.signature as `0x${string}`,
    })
    .catch(() => false);
  if (!valid) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  const walletAddress = fields.address.toLowerCase();
  return NextResponse.json({
    sessionToken: await issueWalletSession(walletAddress),
    walletAddress,
  });
}
