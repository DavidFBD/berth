/**
 * Every pour's intent lands on the Sonic hub regardless of source chain, so
 * one RPC serves all verification. Same pinned endpoint the app itself uses.
 */
const SONIC_RPC = "https://sonic-rpc.publicnode.com";

/** Injection points for tests; production callers pass nothing. */
export type HubTxOptions = {
  rpcUrl?: string;
  fetchImpl?: typeof fetch;
};

/**
 * The hub tx must exist and have succeeded before it earns anything. This
 * plus the (kind, ref) unique index is the anti-abuse floor: a hash can't be
 * invented, can't be replayed, and a failed intent pays nothing. It does not
 * yet prove the hash belongs to the caller — noted as deferred hardening.
 */
export async function hubTxSucceeded(
  txHash: string,
  { rpcUrl = SONIC_RPC, fetchImpl = fetch }: HubTxOptions = {},
): Promise<boolean> {
  try {
    const response = await fetchImpl(rpcUrl, {
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
