import { describe, expect, it, vi } from "vitest";
import { ChainKeys } from "@sodax/sdk";
import { SUBMIT_TX_URL, forwardSubmit, parseSubmitBody } from "./sodax-submit";

const good = {
  txHash: "0x" + "a".repeat(64),
  srcChainKey: Object.values(ChainKeys)[0],
  walletAddress: "0x" + "b".repeat(40),
  intent: {
    intentId: "1",
    creator: "0xabc",
    inputToken: "0x1",
    outputToken: "0x2",
    inputAmount: "5",
    minOutputAmount: "4",
    deadline: "0",
    allowPartialFill: false,
    srcChain: "23",
    dstChain: 146,
    srcAddress: "0xaa",
    dstAddress: "0xbb",
    solver: "0x0",
    data: "0x",
  },
  relayData: "0xdeadbeef",
  operation: "deposit",
};

describe("parseSubmitBody", () => {
  it("accepts a good body and drops unknown keys", () => {
    const parsed = parseSubmitBody({ ...good, extra: "x" });
    expect(parsed).toEqual(good);
  });

  it("drops unknown intent keys", () => {
    const parsed = parseSubmitBody({ ...good, intent: { ...good.intent, feeAmount: "9", extra: { deep: 1 } } });
    expect(parsed?.intent).toEqual(good.intent);
  });

  it("rejects bad bodies", () => {
    const bad: unknown[] = [
      null,
      [],
      "x",
      { ...good, txHash: "../etc" },
      { ...good, txHash: undefined },
      { ...good, srcChainKey: "not-a-chain" },
      { ...good, walletAddress: "" },
      { ...good, intent: {} },
      { ...good, intent: [] },
      { ...good, intent: { ...good.intent, intentId: 5 } },
      { ...good, intent: { ...good.intent, allowPartialFill: "no" } },
      { ...good, intent: { ...good.intent, srcChain: undefined } },
      { ...good, intent: JSON.parse(`{"__proto__":{},"intentId":"1"}`) },
      { ...good, intent: JSON.parse(JSON.stringify({ ...good.intent, constructor: "x" })) },
      { ...good, relayData: "" },
      { ...good, relayData: "deadbeef" },
      { ...good, operation: "swap" },
    ];
    for (const body of bad) expect(parseSubmitBody(body)).toBeNull();
  });
});

describe("forwardSubmit", () => {
  const reply = (init: { ok: boolean; status?: number; json?: unknown }) =>
    vi.fn(async () => ({ ok: init.ok, status: init.status ?? 200, json: async () => init.json }) as unknown as Response);

  it("posts to submit-tx with the key header", async () => {
    const fetchImpl = reply({ ok: true, json: { success: true, data: { status: "inserted" } } });
    const out = await forwardSubmit(good as never, "k3y", fetchImpl as never);
    expect(out).toEqual({ status: 200, body: { ok: true, result: "inserted" } });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(SUBMIT_TX_URL);
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("k3y");
    expect(JSON.parse(init.body as string)).toEqual(good);
  });

  it("forwards without a header when no key is set", async () => {
    const fetchImpl = reply({ ok: true, json: { data: { status: "duplicate" } } });
    const out = await forwardSubmit(good as never, undefined, fetchImpl as never);
    expect(out.body.result).toBe("duplicate");
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.headers).not.toHaveProperty("x-api-key");
  });

  it("counts success:false and a missing status as refused", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    for (const json of [{ success: false, data: { status: "inserted" } }, { success: true, data: {} }, { success: true }]) {
      const out = await forwardSubmit(good as never, "k", reply({ ok: true, json }) as never);
      expect(out).toEqual({ status: 502, body: { ok: false } });
    }
    expect(info.mock.calls[0][0]).toContain("refused 200");
    info.mockRestore();
  });

  it("logs one line without the key or the wallet", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await forwardSubmit(good as never, "k3y", reply({ ok: true, json: { success: true, data: { status: "inserted" } } }) as never);
    const line = String(info.mock.calls[0][0]);
    expect(line).toContain("inserted");
    expect(line).not.toContain("k3y");
    expect(line).not.toContain(good.walletAddress);
    info.mockRestore();
  });

  it("reduces an upstream failure or a throw to a bare 502", async () => {
    const warn = vi.spyOn(console, "info").mockImplementation(() => {});
    expect(await forwardSubmit(good as never, "k", reply({ ok: false, status: 401 }) as never)).toEqual({
      status: 502,
      body: { ok: false },
    });
    const boom = vi.fn(async () => {
      throw new Error("x-api-key k leaked");
    });
    const out = await forwardSubmit(good as never, "k", boom as never);
    expect(JSON.stringify(out)).not.toContain("leaked");
    expect(out.status).toBe(502);
    warn.mockRestore();
  });
});
