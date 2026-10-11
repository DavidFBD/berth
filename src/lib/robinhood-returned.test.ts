import { describe, expect, it, vi } from "vitest";
import { getAddress } from "viem";
import { TOKEN_LISTINGS } from "@/lib/listings";
import {
  RETURNED_LISTINGS,
  RETURNED_TOKENS,
  readReturned,
  holdingSplitAmounts,
  readReturnedRaw,
  returnedOwners,
  returnedUnits,
  robinhoodHubWallet,
  sumReturnedRaw,
} from "./robinhood-returned";

const NVDA = TOKEN_LISTINGS.find((listing) => listing.symbol === "NVDA")!;
const OWNER = "0x00000000000000000000000000000000000000aa";
const HUB = "0x00000000000000000000000000000000000000bb";
const ONE = 10n ** 18n;

/** A multicall that answers `balances[token][holder]`, zero elsewhere, and records what it was asked. */
function fakeMulticall(balances: Record<string, Record<string, bigint>>) {
  return {
    multicall: vi.fn(async ({ contracts }: { contracts: { address: string; args: readonly [string] }[] }) =>
      contracts.map((call) => balances[call.address.toLowerCase()]?.[call.args[0].toLowerCase()] ?? 0n),
    ),
  };
}

describe("what a sell from Robinhood Chain left on Sonic (review M1, sell)", () => {
  it("reads every stock with a token there, its hub asset and its Sonic token", () => {
    expect(RETURNED_LISTINGS.length).toBeGreaterThan(0);
    expect(RETURNED_LISTINGS.every((listing) => listing.kind === "stock")).toBe(true);
    expect(RETURNED_LISTINGS.some((listing) => listing.symbol === "SGOV")).toBe(false);
    expect(RETURNED_TOKENS).toContainEqual({ symbol: "NVDA", token: getAddress(NVDA.rhHubAsset!) });
    expect(RETURNED_TOKENS).toContainEqual({ symbol: "NVDA", token: getAddress(NVDA.address) });
    expect(RETURNED_TOKENS).toHaveLength(RETURNED_LISTINGS.length * 2);
  });

  it("derives the hub wallet for Robinhood Chain, never the home chain's", async () => {
    const hub = { getUserHubWalletAddress: vi.fn(async () => HUB) };
    expect(await robinhoodHubWallet(hub as never, OWNER)).toBe(getAddress(HUB));
    expect(hub.getUserHubWalletAddress).toHaveBeenCalledWith(getAddress(OWNER), "robinhood");
  });

  it("adds the hub asset and the Sonic token of one listing, per hub wallet", async () => {
    const read = fakeMulticall({
      [NVDA.rhHubAsset!.toLowerCase()]: { [HUB]: ONE },
      [NVDA.address.toLowerCase()]: { [HUB]: ONE / 2n },
    });
    const [raw] = await readReturnedRaw(read as never, [getAddress(HUB)]);
    expect(raw.get("NVDA")).toBe((3n * ONE) / 2n);
    expect([...raw.keys()]).toEqual(["NVDA"]);
    expect(returnedUnits(raw)).toEqual({ NVDA: 1.5 });
  });

  it("asks nothing for no owner, and throws when Sonic does not answer", async () => {
    const read = fakeMulticall({});
    expect(await readReturnedRaw(read as never, [])).toEqual([]);
    expect(read.multicall).not.toHaveBeenCalled();
    const failing = { multicall: async () => Promise.reject(new Error("down")) };
    await expect(readReturnedRaw(failing as never, [getAddress(HUB)])).rejects.toThrow("down");
  });

  it("reads each EVM owner once, and adds them up", async () => {
    expect(returnedOwners([OWNER, OWNER.toUpperCase().replace("0X", "0x"), "bc1qnotevm"])).toEqual([getAddress(OWNER)]);
    const other = "0x00000000000000000000000000000000000000cc";
    const otherHub = "0x00000000000000000000000000000000000000dd";
    const hub = { getUserHubWalletAddress: vi.fn(async (owner: string) => (owner.toLowerCase() === OWNER ? HUB : otherHub)) };
    const read = fakeMulticall({ [NVDA.rhHubAsset!.toLowerCase()]: { [HUB]: ONE, [otherHub]: 2n * ONE } });
    const { total, byOwner } = await readReturned(hub as never, read as never, [OWNER, other, OWNER]);
    expect(total.get("NVDA")).toBe(3n * ONE);
    expect(byOwner.get(getAddress(OWNER))?.hubWallet).toBe(getAddress(HUB));
    expect(read.multicall).toHaveBeenCalledTimes(1);
    expect(sumReturnedRaw([new Map([["NVDA", 1n]]), new Map([["NVDA", 2n], ["TSLA", 5n]])])).toEqual(new Map([["NVDA", 3n], ["TSLA", 5n]]));
  });
});

describe("holdingSplitAmounts", () => {
  it("says nothing for a holding wholly in the Berth account or wholly in the own wallet", () => {
    expect(holdingSplitAmounts(5n * ONE, undefined, undefined)).toBeNull();
    expect(holdingSplitAmounts(5n * ONE, 0n, undefined)).toBeNull();
    expect(holdingSplitAmounts(5n * ONE, 5n * ONE, undefined)).toBeNull();
  });

  it("says nothing when the rest of a holding is only what came back from an unfilled sell", () => {
    expect(holdingSplitAmounts(5n * ONE, 3n * ONE, 2n * ONE)).toBeNull();
  });

  it("splits a holding sitting in both places, leaving the returned part out of the account side", () => {
    expect(holdingSplitAmounts(5n * ONE, 2n * ONE, undefined)).toEqual({ inAccount: 3n * ONE, inWallet: 2n * ONE });
    expect(holdingSplitAmounts(6n * ONE, 2n * ONE, 1n * ONE)).toEqual({ inAccount: 3n * ONE, inWallet: 2n * ONE });
  });
});
