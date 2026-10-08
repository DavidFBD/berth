import { describe, expect, it } from "vitest";
import { getAddress, type Address } from "viem";
import type { LeverageYieldSwapPayload } from "@sodax/sdk";
import { TOKEN_LISTINGS } from "@/lib/listings";
import {
  ROBINHOOD_CHAIN_KEY,
  defaultSellSource,
  hubSellSources,
  robinhoodSellPayload,
  robinhoodSellSources,
} from "./robinhood-sell";

const NVDA = TOKEN_LISTINGS.find((listing) => listing.symbol === "NVDA")!;
const WALLET = "0x00000000000000000000000000000000000000aa";
const OTHER = "0x00000000000000000000000000000000000000bb";

/** What sodax.leverageYield.withdraw builds for a sell of NVDA to USDC on Base. */
const built: LeverageYieldSwapPayload = {
  params: {
    inputToken: NVDA.address,
    outputToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    inputAmount: 10n ** 18n,
    minOutputAmount: 170_000_000n,
    deadline: 1_800_000_000n,
    allowPartialFill: false,
    srcChainKey: "0x2105.base" as never,
    dstChainKey: "0x2105.base" as never,
    srcAddress: WALLET,
    dstAddress: WALLET,
    solver: "0x0000000000000000000000000000000000000000",
    data: "0x",
  },
  hubWalletSwap: true,
};

describe("robinhoodSellPayload", () => {
  it("replaces exactly the source chain, the signer and the input token, and drops hubWalletSwap", () => {
    const payload = robinhoodSellPayload(built, { vault: NVDA.address, rhAddress: NVDA.rhAddress!, srcAddress: WALLET });
    expect(payload).toEqual({
      params: {
        ...built.params,
        srcChainKey: ROBINHOOD_CHAIN_KEY,
        srcAddress: getAddress(WALLET),
        inputToken: NVDA.rhAddress,
      },
    });
    expect("hubWalletSwap" in payload).toBe(false);
    // The quote's minimum and the SDK's deadline ride through untouched.
    expect(payload.params.minOutputAmount).toBe(built.params.minOutputAmount);
    expect(payload.params.deadline).toBe(built.params.deadline);
    expect(ROBINHOOD_CHAIN_KEY).toBe("robinhood");
  });

  it("keeps a per intent fee the build carried", () => {
    const fee = { address: OTHER as Address, percentage: 40 };
    expect(robinhoodSellPayload({ ...built, partnerFee: fee }, { vault: NVDA.address, rhAddress: NVDA.rhAddress!, srcAddress: WALLET }).partnerFee).toEqual(fee);
  });

  it("refuses a build of another listing, a buy, a zero minimum or a zero amount", () => {
    const sell = { vault: NVDA.address, rhAddress: NVDA.rhAddress!, srcAddress: WALLET };
    expect(() => robinhoodSellPayload({ ...built, params: { ...built.params, inputToken: OTHER } }, sell)).toThrow();
    expect(() => robinhoodSellPayload({ params: built.params }, sell)).toThrow();
    expect(() => robinhoodSellPayload({ ...built, params: { ...built.params, minOutputAmount: 0n } }, sell)).toThrow();
    expect(() => robinhoodSellPayload({ ...built, params: { ...built.params, inputAmount: 0n } }, sell)).toThrow();
  });
});

describe("sell sources", () => {
  const hub = hubSellSources([{ spoke: WALLET, hubWallet: "0xhub", isHome: true, balance: 5n, canSign: true }]);

  it("lists each wallet on Robinhood Chain that holds the listing, signable only by itself", () => {
    expect(robinhoodSellSources([{ owner: WALLET, balance: 3n }, { owner: OTHER, balance: 2n }, { owner: "0xcc", balance: 0n }], WALLET)).toEqual([
      { key: `robinhood:${WALLET}`, chain: "robinhood", spoke: WALLET, isHome: false, balance: 3n, canSign: true },
      { key: `robinhood:${OTHER}`, chain: "robinhood", spoke: OTHER, isHome: false, balance: 2n, canSign: false },
    ]);
    expect(robinhoodSellSources([{ owner: WALLET, balance: 3n }], undefined)[0].canSign).toBe(false);
  });

  it("keys the account's sources apart from the wallet's, even for one address", () => {
    const rh = robinhoodSellSources([{ owner: WALLET, balance: 3n }], WALLET);
    expect(hub[0].key).not.toBe(rh[0].key);
  });

  it("opens on the wallet on Robinhood Chain when it can sign, else the account", () => {
    const rh = robinhoodSellSources([{ owner: WALLET, balance: 3n }], WALLET);
    expect(defaultSellSource([...hub, ...rh])?.chain).toBe("robinhood");
    expect(defaultSellSource(hub)?.chain).toBe("hub");
    // Not signable there: the account.
    expect(defaultSellSource([...hub, ...robinhoodSellSources([{ owner: OTHER, balance: 9n }], WALLET)])?.chain).toBe("hub");
  });

  it("opens a drafted quantity on the place that holds all of it, never adding two", () => {
    const rh = robinhoodSellSources([{ owner: WALLET, balance: 3n }], WALLET);
    expect(defaultSellSource([...hub, ...rh], 4n)?.chain).toBe("hub");
    expect(defaultSellSource([...hub, ...rh], 3n)?.chain).toBe("robinhood");
    // Neither holds 7: the first that can sign, and the sheet caps the amount there.
    expect(defaultSellSource([...hub, ...rh], 7n)?.chain).toBe("robinhood");
  });

  it("falls back to the home, then the first, when nothing can be signed here", () => {
    const unsignable = hubSellSources([
      { spoke: OTHER, hubWallet: "0xb", isHome: false, balance: 1n, canSign: false },
      { spoke: WALLET, hubWallet: "0xa", isHome: true, balance: 1n, canSign: false },
    ]);
    expect(defaultSellSource(unsignable)?.spoke).toBe(WALLET);
    expect(defaultSellSource([])).toBeUndefined();
  });
});
