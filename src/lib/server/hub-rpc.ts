import { HUB_RPC_URLS } from "@/lib/sodax-config";

/**
 * One JSON-RPC read on the hub (Sonic) for server code that talks to the
 * chain with plain fetch rather than through the SDK. It walks the same
 * list the SDK's hub client fails over through (lib/sodax-config
 * HUB_RPC_URLS: publicnode, then dRPC, then soniclabs) and moves on at an
 * HTTP error, a timeout or a JSON-RPC error, inside one overall deadline.
 * A null result is an answer (the node has no such thing), not a failure.
 *
 * Not for reads that must all come from one backend (logs and a balance
 * read at the same block): those keep a single endpoint.
 */
/**
 * The budget for a hub read made inside a request (the pour route, limit
 * order placement): 4s for one endpoint, 8s across the failover. A route
 * makes several such reads in a row under Vercel's maxDuration, so a hung
 * first endpoint must cost seconds, not tens of them.
 */
export const ROUTE_READ = { attemptMs: 4_000, totalMs: 8_000 } as const;

export type HubRpcAnswer<T> = { ok: true; result: T | null } | { ok: false };

export async function hubRpc<T>(
  method: string,
  params: unknown[],
  {
    attemptMs = 6_000,
    totalMs = attemptMs,
    urls = HUB_RPC_URLS,
    fetcher = fetch,
  }: { attemptMs?: number; totalMs?: number; urls?: readonly string[]; fetcher?: typeof fetch } = {},
): Promise<HubRpcAnswer<T>> {
  const deadline = Date.now() + totalMs;
  for (const url of urls) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    try {
      const response = await fetcher(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        cache: "no-store",
        signal: AbortSignal.timeout(Math.min(attemptMs, remaining)),
      });
      if (!response.ok) continue;
      const payload = (await response.json()) as { result?: T | null; error?: unknown };
      if (payload.error) continue;
      return { ok: true, result: payload.result ?? null };
    } catch {
      // A timeout or a network error: the next endpoint.
    }
  }
  return { ok: false };
}
