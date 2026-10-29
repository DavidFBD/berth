import { describe, expect, it, vi } from "vitest";
import { buildShadowSubmit, shadowSubmit } from "./sodax-shadow";

const intent = {
  intentId: 123456789012345678901234567890n,
  inputAmount: 5n,
  minOutputAmount: 4n,
  deadline: 0n,
  feeAmount: 9n,
  creator: "0xabc",
};
const base = {
  tx: "0x" + "a".repeat(64),
  srcChainKey: "0xa4b1.arbitrum",
  walletAddress: "0x" + "b".repeat(40),
  intent,
  relayData: { address: "0x1", payload: "0xdeadbeef" },
};

describe("buildShadowSubmit", () => {
  it("writes bigints as decimal strings and drops the display-only feeAmount", () => {
    const body = buildShadowSubmit(base)!;
    expect(body.intent.intentId).toBe("123456789012345678901234567890");
    expect(body.intent.inputAmount).toBe("5");
    expect(body.intent).not.toHaveProperty("feeAmount");
    expect(body.relayData).toBe("0xdeadbeef");
    expect(() => JSON.stringify(body)).not.toThrow();
  });

  it("is a deposit for a buy and a withdraw for a sell", () => {
    expect(buildShadowSubmit(base)!.operation).toBe("deposit");
    expect(buildShadowSubmit({ ...base, hubWalletSwap: false })!.operation).toBe("deposit");
    expect(buildShadowSubmit({ ...base, hubWalletSwap: true })!.operation).toBe("withdraw");
  });

  it("builds nothing without a hex relay payload", () => {
    expect(buildShadowSubmit({ ...base, relayData: undefined })).toBeNull();
    expect(buildShadowSubmit({ ...base, relayData: { payload: "" } })).toBeNull();
    expect(buildShadowSubmit({ ...base, relayData: { payload: { a: 1 } } })).toBeNull();
  });
});

describe("shadowSubmit", () => {
  it("sends the caller's auth, never awaits, and swallows every failure", async () => {
    const calls: [string, RequestInit][] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => { calls.push([url, init]); throw new Error("down"); }));
    shadowSubmit({ ...base, headers: async () => ({ authorization: "Bearer t" }) });
    await new Promise((r) => setTimeout(r, 0));
    expect((calls[0][1].headers as Record<string, string>).authorization).toBe("Bearer t");
    shadowSubmit({ ...base, headers: async () => { throw new Error("no token"); } });
    shadowSubmit({ ...base, headers: async () => null });
    shadowSubmit(base);
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toHaveLength(1);
    vi.unstubAllGlobals();
  });
});
