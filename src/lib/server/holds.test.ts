import { beforeEach, describe, expect, it, vi } from "vitest";

const multicall = vi.fn();
vi.mock("@/lib/server/pour-verify", () => ({
  getSodax: () => ({ hubProvider: { publicClient: { multicall } } }),
}));

import { deliveredBalancesReader, readDeliveredBalances } from "./holds";
import { TOKEN_LISTINGS } from "@/lib/listings";

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

describe("deliveredBalancesReader", () => {
  const NVDA = TOKEN_LISTINGS.find((listing) => listing.symbol === "NVDA")!;

  beforeEach(() => {
    multicall.mockReset();
  });

  it("reads a Robinhood Chain row as the listing's token there and a hub row on the hub, in the order asked", async () => {
    multicall.mockResolvedValue([{ status: "success", result: 7n }]);
    const robinhood = vi.fn(async (queries: readonly { holder: string; token: string }[]) => queries.map(() => 3n));
    const read = deliveredBalancesReader(robinhood);
    const balances = await read([
      { holder: HOLDER, listing: NVDA.address, chain: "robinhood" },
      { holder: HOLDER, listing: A },
      { holder: HOLDER, listing: A, chain: "robinhood" },
    ]);
    // The hub row from the hub; NVDA from its token on Robinhood Chain; a listing with no token there is unknown.
    expect(balances).toEqual([3n, 7n, null]);
    expect(robinhood).toHaveBeenCalledWith([{ holder: HOLDER, token: NVDA.rhAddress }]);
    expect(multicall.mock.calls[0][0].contracts).toHaveLength(1);
  });

  it("answers unknown, never zero, when Robinhood Chain throws", async () => {
    const read = deliveredBalancesReader(async () => {
      throw new Error("down");
    });
    expect(await read([{ holder: HOLDER, listing: NVDA.address, chain: "robinhood" }])).toEqual([null]);
    expect(multicall).not.toHaveBeenCalled();
  });
});
