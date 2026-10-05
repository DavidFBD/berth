import { describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import { ROBINHOOD_EXPLORER_URL, readRobinhoodBalances, robinhoodTokenUrl, robinhoodTxUrl } from "./robinhood-chain";

const A = "0x0000000000000000000000000000000000000001" as Address;
const B = "0x0000000000000000000000000000000000000002" as Address;
const T1 = { rhAddress: "0x00000000000000000000000000000000000000a1" as Address };
const T2 = { rhAddress: "0x00000000000000000000000000000000000000a2" as Address };

describe("readRobinhoodBalances", () => {
  it("asks balanceOf of every token for every owner in one multicall and sums per token", async () => {
    const multicall = vi.fn(async () => [1n, 2n, 10n, 20n]);
    const totals = await readRobinhoodBalances({ multicall } as never, [T1, T2], [A, B]);
    expect(totals).toEqual([11n, 22n]);
    expect(multicall).toHaveBeenCalledTimes(1);
    const call = (multicall.mock.calls[0] as unknown as [{ contracts: { address: string; args: readonly unknown[] }[]; allowFailure: boolean }])[0];
    expect(call.allowFailure).toBe(false);
    expect(call.contracts.map((contract) => [contract.address, contract.args[0]])).toEqual([
      [T1.rhAddress, A],
      [T2.rhAddress, A],
      [T1.rhAddress, B],
      [T2.rhAddress, B],
    ]);
  });

  it("makes no call with no owner or no token", async () => {
    const multicall = vi.fn();
    expect(await readRobinhoodBalances({ multicall } as never, [T1], [])).toEqual([0n]);
    expect(await readRobinhoodBalances({ multicall } as never, [], [A])).toEqual([]);
    expect(multicall).not.toHaveBeenCalled();
  });

  it("lets a failed read fail, so the caller shows it as unread, never as zero", async () => {
    const multicall = vi.fn(async () => {
      throw new Error("rpc down");
    });
    await expect(readRobinhoodBalances({ multicall } as never, [T1], [A])).rejects.toThrow("rpc down");
  });
});

describe("explorer links", () => {
  it("point at Robinhood Chain's Blockscout", () => {
    expect(ROBINHOOD_EXPLORER_URL).toBe("https://robinhoodchain.blockscout.com");
    expect(robinhoodTxUrl("0xabc")).toBe("https://robinhoodchain.blockscout.com/tx/0xabc");
    expect(robinhoodTokenUrl(T1.rhAddress)).toBe(`https://robinhoodchain.blockscout.com/token/${T1.rhAddress}`);
  });
});
