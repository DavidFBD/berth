import { describe, expect, it } from "vitest";
import { hubTxSucceeded } from "./hub-tx";

const HASH = `0x${"ab".repeat(32)}`;

/** A fetch that always answers with the given JSON-RPC payload. */
function rpcAnswering(
  payload: unknown,
  ok = true,
): { fetchImpl: typeof fetch; calls: { url: string; body: string }[] } {
  const calls: { url: string; body: string }[] = [];
  const fetchImpl = (async (url, init) => {
    calls.push({ url: String(url), body: String(init?.body) });
    return { ok, json: async () => payload } as Response;
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe("hubTxSucceeded", () => {
  it("accepts a receipt with success status", async () => {
    const { fetchImpl } = rpcAnswering({ result: { status: "0x1" } });
    expect(await hubTxSucceeded(HASH, { fetchImpl })).toBe(true);
  });

  it("rejects a reverted receipt", async () => {
    const { fetchImpl } = rpcAnswering({ result: { status: "0x0" } });
    expect(await hubTxSucceeded(HASH, { fetchImpl })).toBe(false);
  });

  it("rejects a missing receipt (unknown or pending hash)", async () => {
    const { fetchImpl } = rpcAnswering({ result: null });
    expect(await hubTxSucceeded(HASH, { fetchImpl })).toBe(false);
  });

  it("rejects an RPC error status without throwing", async () => {
    const { fetchImpl } = rpcAnswering({}, false);
    expect(await hubTxSucceeded(HASH, { fetchImpl })).toBe(false);
  });

  it("swallows network failure and answers false", async () => {
    const fetchImpl = (async () => {
      throw new Error("rpc down");
    }) as typeof fetch;
    expect(await hubTxSucceeded(HASH, { fetchImpl })).toBe(false);
  });

  it("asks the given RPC for the receipt of exactly this hash", async () => {
    const { fetchImpl, calls } = rpcAnswering({ result: { status: "0x1" } });
    await hubTxSucceeded(HASH, { fetchImpl, rpcUrl: "https://rpc.example" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://rpc.example");
    const body = JSON.parse(calls[0].body) as {
      method: string;
      params: string[];
    };
    expect(body.method).toBe("eth_getTransactionReceipt");
    expect(body.params).toEqual([HASH]);
  });
});
