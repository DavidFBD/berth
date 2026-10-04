import { describe, expect, it } from "vitest";
import { ROUTE_READ } from "./hub-rpc";
import { FILL_LOG_URLS, orderRpc } from "./orders";
import { HUB_RPC_URLS } from "@/lib/sodax-config";

/**
 * The order's hub reads run inside the pour route after its proofs, up to
 * four in a row (receipt, placed time, fill search, filled time), so each
 * keeps the route budget pour-verify uses, and the fill search never spends
 * it on dRPC, whose free plan refuses its 20k block range every time.
 */

const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("order hub reads", () => {
  it("keep the route budget: 4s an endpoint, 8s a read, so four reads cost at most 32s", () => {
    expect(ROUTE_READ).toEqual({ attemptMs: 4_000, totalMs: 8_000 });
    expect(4 * ROUTE_READ.totalMs).toBeLessThanOrEqual(32_000);
  });

  it("search for the fill on publicnode, then soniclabs, never dRPC", () => {
    expect(FILL_LOG_URLS).toEqual(["https://sonic-rpc.publicnode.com", "https://rpc.soniclabs.com"]);
    expect(HUB_RPC_URLS.some((url) => url.includes("drpc"))).toBe(true);
  });

  it("give up on a hung endpoint inside the attempt budget and ask the next", async () => {
    const asked: string[] = [];
    const signals: AbortSignal[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      asked.push(url);
      signals.push(init.signal!);
      if (url === FILL_LOG_URLS[0]) {
        // Hangs until the attempt's own timeout aborts it.
        return new Promise<Response>((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason)));
      }
      return answer({ jsonrpc: "2.0", id: 1, result: [] });
    }) as unknown as typeof fetch;
    const started = Date.now();
    // A short test budget stands in for the 4s one; the wiring is what is under test.
    const logs = await orderRpc("eth_getLogs", [{}], { urls: FILL_LOG_URLS, fetcher, budget: { attemptMs: 50, totalMs: 100 } });
    expect(logs).toEqual([]);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(asked).toEqual(FILL_LOG_URLS);
    expect(signals[0].aborted).toBe(true);
  });

  it("are undefined when nothing answers inside the read budget", async () => {
    const fetcher = (async (_url: string, init: RequestInit) =>
      new Promise<Response>((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason)))) as unknown as typeof fetch;
    const started = Date.now();
    expect(await orderRpc("eth_blockNumber", [], { fetcher, budget: { attemptMs: 50, totalMs: 80 } })).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
