import { afterEach, describe, expect, it, vi } from "vitest";
import { placeLimitOrder } from "./limit-orders";
import { getSodax } from "./pour-verify";

/**
 * Placing a limit order whose hub receipt succeeded but whose intent the
 * SDK could not read: the receipt and the SDK's read may come from
 * different endpoints, so a lagging or silent read is "not yet known"
 * (503, asked again) when the receipt holds an IntentCreated, and only a
 * receipt without one is "not confirmed".
 */

const TX = `0x${"ab".repeat(32)}`;

function receiptWith(logs: { address: string; topics: string[]; data: string }[]) {
  vi.stubGlobal("fetch", async () =>
    new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { status: "0x1", blockNumber: "0x10", from: "0x01", to: "0x02", logs } })),
  );
}

function place(readIntent: (tx: string) => Promise<{ ok: false }>) {
  return placeLimitOrder({
    userId: "u1",
    owners: new Set(),
    owns: async () => true,
    intentTx: TX,
    direction: "buy",
    readIntent,
  });
}

describe("placeLimitOrder when the intent read fails", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const intents = () => getSodax().config.solver.intentsContract.toLowerCase();
  const created = () => ({ address: intents(), topics: [`0x29fecd55${"0".repeat(56)}`], data: "0x" });

  it("is not yet known when the receipt holds an IntentCreated and the read failed", async () => {
    receiptWith([created()]);
    expect(await place(async () => ({ ok: false }))).toEqual({ ok: false, reason: "not yet known" });
  });

  it("is not yet known when the receipt holds an IntentCreated and the read threw", async () => {
    receiptWith([created()]);
    expect(
      await place(async () => {
        throw new Error("timed out");
      }),
    ).toEqual({ ok: false, reason: "not yet known" });
  });

  it("is not confirmed when the receipt holds no IntentCreated", async () => {
    receiptWith([{ ...created(), address: "0x1111111111111111111111111111111111111111" }]);
    expect(await place(async () => ({ ok: false }))).toEqual({ ok: false, reason: "not confirmed" });
  });
});
