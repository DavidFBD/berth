import { describe, expect, it } from "vitest";
import { hubRpc } from "./hub-rpc";

/** The hub read for plain-fetch server code: the same endpoints the SDK fails over through, in order. */

const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("hubRpc", () => {
  it("moves past a dead endpoint and a JSON-RPC error to the first that answers", async () => {
    const asked: string[] = [];
    const fetcher = (async (url: string) => {
      asked.push(url);
      if (url === "a") return answer({ error: "No backend available" }, 503);
      if (url === "b") return answer({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "busy" } });
      return answer({ jsonrpc: "2.0", id: 1, result: "0x10" });
    }) as unknown as typeof fetch;
    expect(await hubRpc("eth_blockNumber", [], { urls: ["a", "b", "c"], fetcher })).toEqual({ ok: true, result: "0x10" });
    expect(asked).toEqual(["a", "b", "c"]);
  });

  it("takes a null result as an answer, not a failure", async () => {
    const asked: string[] = [];
    const fetcher = (async (url: string) => {
      asked.push(url);
      return answer({ jsonrpc: "2.0", id: 1, result: null });
    }) as unknown as typeof fetch;
    expect(await hubRpc("eth_getTransactionReceipt", ["0x01"], { urls: ["a", "b"], fetcher })).toEqual({ ok: true, result: null });
    expect(asked).toEqual(["a"]);
  });

  it("is not ok when every endpoint fails", async () => {
    const fetcher = (async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    expect(await hubRpc("eth_blockNumber", [], { urls: ["a", "b"], fetcher })).toEqual({ ok: false });
  });

  it("tries the SDK's hub list, publicnode first, by default", async () => {
    const asked: string[] = [];
    const fetcher = (async (url: string) => {
      asked.push(url);
      return answer({ jsonrpc: "2.0", id: 1, result: "0x1" });
    }) as unknown as typeof fetch;
    await hubRpc("eth_blockNumber", [], { fetcher });
    expect(asked).toEqual(["https://sonic-rpc.publicnode.com"]);
  });
});
