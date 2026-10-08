import { describe, expect, it } from "vitest";
import { getAddress, type Address } from "viem";
import type { LeverageYieldSwapPayload } from "@sodax/sdk";
import { TOKEN_LISTINGS } from "@/lib/listings";
import {
  ROBINHOOD_CHAIN_KEY,
  ROBINHOOD_SELL_DEADLINE_SECONDS,
  defaultSellSource,
  hubSellSources,
  robinhoodSellDeadline,
  robinhoodSellPaused,
  robinhoodSellPayload,
  robinhoodSellSources,
} from "./robinhood-sell";

const NVDA = TOKEN_LISTINGS.find((listing) => listing.symbol === "NVDA")!;
const HUB_TIME = 1_799_999_000n;
const DEADLINE = HUB_TIME + BigInt(ROBINHOOD_SELL_DEADLINE_SECONDS);
const WALLET = "0x00000000000000000000000000000000000000aa";
const OTHER = "0x00000000000000000000000000000000000000bb";

/** What sodax.leverageYield.withdraw builds for a sell of NVDA to USDC on Base. */
const built: LeverageYieldSwapPayload = {
  params: {
    inputToken: NVDA.address,
    outputToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    inputAmount: 10n ** 18n,
    minOutputAmount: 170_000_000n,
    deadline: DEADLINE,
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
    const payload = robinhoodSellPayload(built, { vault: NVDA.address, rhAddress: NVDA.rhAddress!, srcAddress: WALLET, owner: WALLET, deadline: DEADLINE });
    expect(payload).toEqual({
      params: {
        ...built.params,
        srcChainKey: ROBINHOOD_CHAIN_KEY,
        srcAddress: getAddress(WALLET),
        inputToken: NVDA.rhAddress,
      },
    });
    expect("hubWalletSwap" in payload).toBe(false);
    // The quote's minimum and the build's deadline (the sell's own) ride through untouched.
    expect(payload.params.minOutputAmount).toBe(built.params.minOutputAmount);
    expect(payload.params.deadline).toBe(built.params.deadline);
    expect(ROBINHOOD_CHAIN_KEY).toBe("robinhood");
  });

  it("refuses a signer that is not the wallet the sheet chose, in any casing", () => {
    const sell = { vault: NVDA.address, rhAddress: NVDA.rhAddress!, srcAddress: WALLET, deadline: DEADLINE };
    expect(() => robinhoodSellPayload(built, { ...sell, owner: OTHER })).toThrow("not the wallet chosen");
    expect(robinhoodSellPayload(built, { ...sell, owner: getAddress(WALLET) }).params.srcAddress).toBe(getAddress(WALLET));
  });

  it("keeps a per intent fee the build carried", () => {
    const fee = { address: OTHER as Address, percentage: 40 };
    expect(robinhoodSellPayload({ ...built, partnerFee: fee }, { vault: NVDA.address, rhAddress: NVDA.rhAddress!, srcAddress: WALLET, owner: WALLET, deadline: DEADLINE }).partnerFee).toEqual(fee);
  });

  it("refuses a build of another listing, a buy, a zero minimum or a zero amount", () => {
    const sell = { vault: NVDA.address, rhAddress: NVDA.rhAddress!, srcAddress: WALLET, owner: WALLET, deadline: DEADLINE };
    expect(() => robinhoodSellPayload({ ...built, params: { ...built.params, inputToken: OTHER } }, sell)).toThrow();
    expect(() => robinhoodSellPayload({ params: built.params }, sell)).toThrow();
    expect(() => robinhoodSellPayload({ ...built, params: { ...built.params, minOutputAmount: 0n } }, sell)).toThrow();
    expect(() => robinhoodSellPayload({ ...built, params: { ...built.params, inputAmount: 0n } }, sell)).toThrow();
  });
});

describe("the deadline of a sell from Robinhood Chain (review B1)", () => {
  it("is 45 minutes of hub time, far past the SDK's five minute default", () => {
    expect(ROBINHOOD_SELL_DEADLINE_SECONDS).toBe(45 * 60);
    expect(robinhoodSellDeadline(HUB_TIME)).toBe(HUB_TIME + 2_700n);
    expect(robinhoodSellDeadline(HUB_TIME) - HUB_TIME).toBeGreaterThan(300n);
  });

  it("refuses to make one without hub time", () => {
    expect(() => robinhoodSellDeadline(0n)).toThrow();
  });

  it("refuses a build that kept another deadline, such as the SDK's default, or none at all", () => {
    const sell = { vault: NVDA.address, rhAddress: NVDA.rhAddress!, srcAddress: WALLET, owner: WALLET, deadline: DEADLINE };
    const sdkDefault = { ...built, params: { ...built.params, deadline: HUB_TIME + 300n } };
    expect(() => robinhoodSellPayload(sdkDefault, sell)).toThrow("its own deadline");
    expect(() => robinhoodSellPayload({ ...built, params: { ...built.params, deadline: 0n } }, { ...sell, deadline: 0n })).toThrow("its own deadline");
    expect(robinhoodSellPayload(built, sell).params.deadline).toBe(DEADLINE);
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

  it("opens a drafted limit on the home in the Berth account, where a limit can wait, never on Robinhood Chain (review M2, sell)", () => {
    const rh = robinhoodSellSources([{ owner: WALLET, balance: 3n }], WALLET);
    expect(defaultSellSource([...hub, ...rh], undefined, undefined, { limit: true })?.chain).toBe("hub");
    // Even for a quantity only the wallet there holds: the sheet caps it at the home.
    expect(defaultSellSource([...hub, ...rh], 3n, undefined, { limit: true })?.chain).toBe("hub");
    // Without a home this session can sign for, as before.
    const away = hubSellSources([{ spoke: OTHER, hubWallet: "0xhub", isHome: true, balance: 5n, canSign: false }]);
    expect(defaultSellSource([...away, ...rh], undefined, undefined, { limit: true })?.chain).toBe("robinhood");
    // No limit: the wallet there first, as before.
    expect(defaultSellSource([...hub, ...rh], undefined, undefined, { limit: false })?.chain).toBe("robinhood");
  });

  it("opens on the Berth account when the wallet on Robinhood Chain cannot pay its fee, or its fee is unknown (rh-ux-sec M2)", () => {
    const rh = robinhoodSellSources([{ owner: WALLET, balance: 3n }], WALLET);
    const noEth = (source: { chain: string }) => source.chain !== "robinhood";
    expect(defaultSellSource([...hub, ...rh], undefined, noEth)?.chain).toBe("hub");
    // A drafted quantity only the wallet holds still opens there: the account cannot cover it.
    expect(defaultSellSource([...hub, ...rh], 3n, noEth)?.chain).toBe("hub");
    expect(defaultSellSource([...hubSellSources([{ spoke: WALLET, hubWallet: "0xhub", isHome: true, balance: 1n, canSign: true }]), ...rh], 3n, noEth)?.chain).toBe(
      "robinhood",
    );
    // Only the wallet there: it is where the sheet opens, and the gas gate speaks.
    expect(defaultSellSource(rh, undefined, noEth)?.chain).toBe("robinhood");
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

describe("a sell sheet with nothing it may sell from (review: the kill switch)", () => {
  const empty = hubSellSources([{ spoke: WALLET, hubWallet: "0xhub", isHome: true, balance: 0n, canSign: true }]);
  const full = hubSellSources([{ spoke: WALLET, hubWallet: "0xhub", isHome: true, balance: 5n, canSign: true }]);

  it("says selling from Robinhood Chain is paused when no wallet there may be offered and the account holds none of it", () => {
    expect(robinhoodSellPaused(empty, false)).toBe(true);
    expect(robinhoodSellPaused([], false)).toBe(true);
  });

  it("says nothing when the account holds some, or a wallet there may be offered", () => {
    expect(robinhoodSellPaused(full, false)).toBe(false);
    expect(robinhoodSellPaused(empty, true)).toBe(false);
  });
});
