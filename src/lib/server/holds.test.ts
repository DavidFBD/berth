import { beforeEach, describe, expect, it, vi } from "vitest";

const multicall = vi.fn();
vi.mock("@/lib/server/pour-verify", () => ({
  getSodax: () => ({ hubProvider: { publicClient: { multicall } } }),
}));

import { readDeliveredBalances } from "./holds";

/** The real balance reader, with only the chain client stubbed. */

const HOLDER = "0x00000000000000000000000000000000000000aa";
const A = "0x00000000000000000000000000000000000000a1";
const B = "0x00000000000000000000000000000000000000b2";

describe("readDeliveredBalances", () => {
  beforeEach(() => {
    multicall.mockReset();
  });

  it("reads every balanceOf in one multicall, a failed call nulls only its row", async () => {
    multicall.mockResolvedValue([
      { status: "success", result: 5n },
      { status: "failure", error: new Error("reverted") },
    ]);

    const balances = await readDeliveredBalances([
      { holder: HOLDER, listing: A },
      { holder: HOLDER, listing: B },
    ]);

    expect(balances).toEqual([5n, null]);
    expect(multicall).toHaveBeenCalledOnce();
    const [{ allowFailure, contracts }] = multicall.mock.calls[0];
    expect(allowFailure).toBe(true);
    expect(
      contracts.map((c: { address: string; functionName: string; args: string[] }) => [
        c.address,
        c.functionName,
        c.args,
      ]),
    ).toEqual([
      [A, "balanceOf", [HOLDER]],
      [B, "balanceOf", [HOLDER]],
    ]);
  });

  it("answers null for every row when the whole multicall is rejected", async () => {
    multicall.mockImplementation(async () => {
      throw new Error("rpc down");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      await readDeliveredBalances([
        { holder: HOLDER, listing: A },
        { holder: HOLDER, listing: B },
      ]),
    ).toEqual([null, null]);
    warn.mockRestore();
  });

  it("answers nothing for nothing, without touching the chain", async () => {
    expect(await readDeliveredBalances([])).toEqual([]);
    expect(multicall).not.toHaveBeenCalled();
  });

  it("treats a short result as unknown for the missing rows", async () => {
    multicall.mockResolvedValue([]);
    expect(await readDeliveredBalances([{ holder: HOLDER, listing: A }])).toEqual([null]);
  });
});
