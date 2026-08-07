import { NextResponse, type NextRequest } from "next/server";
import { verifyPrivyAuth } from "@/lib/server/privy";
import {
  awardXp,
  getOrCreateUser,
  normalizeWallet,
  toProfile,
} from "@/lib/server/accounts";

/**
 * Every pour's intent lands on the Sonic hub regardless of source chain, so
 * one RPC serves all verification. Same pinned endpoint the app itself uses.
 */
const SONIC_RPC = "https://sonic-rpc.publicnode.com";

/**
 * The hub tx must exist and have succeeded before it earns anything. This
 * plus the (kind, ref) unique index is the anti-abuse floor: a hash can't be
 * invented, can't be replayed, and a failed intent pays nothing. It does not
 * yet prove the hash belongs to the caller — noted as deferred hardening.
 */
async function hubTxSucceeded(txHash: string): Promise<boolean> {
  try {
    const response = await fetch(SONIC_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getTransactionReceipt",
        params: [txHash],
      }),
      cache: "no-store",
    });
    if (!response.ok) return false;
    const { result } = (await response.json()) as {
      result?: { status?: string } | null;
    };
    return result?.status === "0x1";
  } catch {
    return false;
  }
}

/** Reward a filled pour. Body: direction ('in' | 'out') + the intent's hub tx hash. */
export async function POST(request: NextRequest) {
  let did: string | null;
  try {
    did = await verifyPrivyAuth(request.headers.get("authorization"));
  } catch {
    return NextResponse.json({ error: "invalid token" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    direction?: unknown;
    intentTxHash?: unknown;
    walletAddress?: unknown;
  };
  const wallet = normalizeWallet(body.walletAddress);
  const direction = body.direction === "out" ? "pour_out" : "pour_in";
  const txHash =
    typeof body.intentTxHash === "string"
      ? body.intentTxHash.toLowerCase()
      : "";
  if (!/^0x[0-9a-f]{64}$/.test(txHash)) {
    return NextResponse.json({ error: "bad tx hash" }, { status: 400 });
  }

  const result = await getOrCreateUser({ did, wallet });
  if (!result) {
    return NextResponse.json({ error: "no identity" }, { status: 400 });
  }

  if (!(await hubTxSucceeded(txHash))) {
    return NextResponse.json({ error: "tx not confirmed" }, { status: 422 });
  }

  const { awarded, xp } = await awardXp(result.user.id, direction, txHash);
  return NextResponse.json({
    ...toProfile({ ...result.user, xp }),
    rewards: awarded > 0 ? [{ kind: direction, amount: awarded }] : [],
  });
}
