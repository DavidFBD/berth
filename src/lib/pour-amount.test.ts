import { describe, expect, it } from "vitest";
import { ChainKeys } from "@sodax/sdk";
import {
  BTC_DUST_SATS,
  amountText,
  applySlippage,
  belowBtcDust,
  belowMinimum,
  depositGate,
  depositMax,
  minPourUsd,
  minReceivedFor,
  pourAmounts,
  quoteInputFor,
  withdrawGate,
} from "./pour-amount";

describe("pourAmounts", () => {
  it("reads money when priced and the field is in money", () => {
    // 10 (in whatever currency the price speaks) of a 2-per-token price
    // with 6 decimals = 5 tokens.
    const result = pourAmounts("10", "money", 6, 2);
    expect(result.moneyMode).toBe(true);
    expect(result.buildAmount).toBe(5_000_000n);
    expect(result.worth).toBeCloseTo(10);
  });

  it("reads tokens in token mode", () => {
    const result = pourAmounts("1.5", "token", 8, 3);
    expect(result.moneyMode).toBe(false);
    expect(result.buildAmount).toBe(150_000_000n);
    expect(result.worth).toBeCloseTo(4.5);
  });

  it("falls back to token entry for unpriced tokens, even in money denom", () => {
    const result = pourAmounts("2", "money", 6, undefined);
    expect(result.moneyMode).toBe(false);
    expect(result.buildAmount).toBe(2_000_000n);
    expect(result.worth).toBeUndefined();
  });

  it("rejects garbage, zero, and negatives", () => {
    for (const text of ["", "abc", "0", "-1", "1e5"]) {
      expect(pourAmounts(text, "token", 6, 1).buildAmount).toBeUndefined();
    }
  });

  it("yields nothing without a token", () => {
    const result = pourAmounts("5", "money", undefined, 2);
    expect(result).toEqual({
      moneyMode: false,
      buildAmount: undefined,
      worth: undefined,
    });
  });
});

describe("quoteInputFor (the fee pairing)", () => {
  it("asks the quote for the post-fee amount", () => {
    // PARTNER_FEE is 40 bps: the quote input must be under the build amount.
    const build = 1_000_000n;
    const quoteInput = quoteInputFor(build);
    expect(quoteInput).toBeDefined();
    expect(quoteInput!).toBeLessThan(build);
    expect(quoteInput!).toBeGreaterThan(0n);
  });

  it("passes undefined through", () => {
    expect(quoteInputFor(undefined)).toBeUndefined();
  });
});

describe("slippage", () => {
  it("applies percent as basis points, floor division", () => {
    expect(applySlippage(10_000n, 0.5)).toBe(9_950n);
    expect(applySlippage(1_000n, 0.5)).toBe(995n);
  });

  it("minReceivedFor uses the app default", () => {
    expect(minReceivedFor(10_000n)).toBe(applySlippage(10_000n, 0.5));
    expect(minReceivedFor(undefined)).toBeUndefined();
  });
});

describe("depositMax", () => {
  it("waits for the gas buffer", () => {
    expect(depositMax(100n, undefined)).toEqual({ kind: "bufferLoading" });
  });

  it("withholds the buffer", () => {
    expect(depositMax(100n, 30n)).toEqual({ kind: "ready", amount: 70n });
    expect(depositMax(100n, 0n)).toEqual({ kind: "ready", amount: 100n });
  });

  it("reports an unspendable balance", () => {
    expect(depositMax(100n, 100n)).toEqual({ kind: "nothingSpendable" });
    expect(depositMax(50n, 100n)).toEqual({ kind: "nothingSpendable" });
  });
});

describe("amountText", () => {
  it("floors money to whole cents so Max stays spendable", () => {
    // 1.999999 tokens at 1-per-token = 1.999999 → "1.99", never "2.00".
    expect(amountText(1_999_999n, 6, true, 1)).toBe("1.99");
  });

  it("floors at the currency's own precision (whole yen)", () => {
    // 1.9 tokens at ¥150 = ¥285 exactly; 285.75 would floor to 285.
    expect(amountText(1_905_000n, 6, true, 150, 0)).toBe("285");
  });

  it("prints exact token units in token mode", () => {
    expect(amountText(1_500_000n, 6, false, undefined)).toBe("1.5");
  });
});

describe("belowBtcDust", () => {
  const btc = ChainKeys.BITCOIN_MAINNET;
  it("flags native BTC just under the dust limit", () => {
    expect(belowBtcDust(btc, "BTC", BTC_DUST_SATS - 1n)).toBe(true);
  });
  it("clears exactly at the limit", () => {
    expect(belowBtcDust(btc, "BTC", BTC_DUST_SATS)).toBe(false);
  });
  it("only applies to native BTC", () => {
    expect(belowBtcDust(btc, "WBTC", 1n)).toBe(false);
    expect(belowBtcDust(ChainKeys.SONIC_MAINNET, "BTC", 1n)).toBe(false);
    expect(belowBtcDust(null, "BTC", 1n)).toBe(false);
  });
  it("holds until a quote exists", () => {
    expect(belowBtcDust(btc, "BTC", undefined)).toBe(false);
  });
});

describe("the pour floor", () => {
  it("is one dollar in USD", () => {
    expect(minPourUsd(1)).toBe(1);
    expect(belowMinimum(0.99)).toBe(true);
    expect(belowMinimum(1)).toBe(false);
  });

  it("rounds up to a whole unit of the display currency", () => {
    // €0.86 per dollar: the floor becomes €1, which is $1.163.
    expect(minPourUsd(0.86)).toBeCloseTo(1 / 0.86);
    expect(belowMinimum(1.1, 0.86)).toBe(true);
    expect(belowMinimum(1.2, 0.86)).toBe(false);
    // ¥150 per dollar: ¥150 is exactly a dollar.
    expect(minPourUsd(150)).toBe(1);
  });

  it("treats an unsettled rate as USD", () => {
    expect(minPourUsd(0)).toBe(1);
    expect(minPourUsd(Number.NaN)).toBe(1);
  });

  it("lets unpriced pours through to the solver", () => {
    expect(belowMinimum(undefined)).toBe(false);
  });
});

describe("depositGate", () => {
  const ready = {
    hasToken: true,
    address: "0xabc",
    buildAmount: 100n,
    balance: 200n,
    belowMinimum: false,
    isWrongChain: false,
    noRoute: false,
    quoted: 90n,
    minOut: 89n,
    hasWalletProvider: true,
  };

  it("passes a complete pour", () => {
    expect(depositGate(ready)).toEqual({ kind: "ready" });
  });

  it("walks the ladder in actionable order", () => {
    expect(depositGate({ ...ready, hasToken: false }).kind).toBe("pickToken");
    expect(depositGate({ ...ready, address: undefined }).kind).toBe("connectSource");
    expect(depositGate({ ...ready, buildAmount: undefined }).kind).toBe("enterAmount");
    expect(depositGate({ ...ready, balance: undefined }).kind).toBe("balanceLoading");
    expect(depositGate({ ...ready, buildAmount: 300n }).kind).toBe("insufficient");
    expect(depositGate({ ...ready, belowMinimum: true }).kind).toBe("belowMinimum");
    expect(depositGate({ ...ready, isWrongChain: true }).kind).toBe("wrongChain");
    expect(depositGate({ ...ready, noRoute: true }).kind).toBe("noRoute");
    expect(depositGate({ ...ready, quoted: undefined }).kind).toBe("quotePending");
    expect(depositGate({ ...ready, hasWalletProvider: false }).kind).toBe("quotePending");
  });

  it("routes to the picker before the wallet: token-first", () => {
    expect(depositGate({ ...ready, hasToken: false, address: undefined }).kind).toBe(
      "pickToken",
    );
  });

  it("checks the balance before the network", () => {
    expect(
      depositGate({ ...ready, buildAmount: 300n, isWrongChain: true }).kind,
    ).toBe("insufficient");
  });

  it("asks for a bigger pour before a network switch, and after the balance", () => {
    expect(
      depositGate({ ...ready, belowMinimum: true, isWrongChain: true }).kind,
    ).toBe("belowMinimum");
    expect(
      depositGate({ ...ready, belowMinimum: true, buildAmount: 300n }).kind,
    ).toBe("insufficient");
  });
});

describe("withdrawGate", () => {
  const ready = {
    address: "0xabc",
    hasDestination: true,
    recipient: "0xdef",
    usingCustomRecipient: false,
    buildAmount: 100n,
    availableShares: 200n,
    belowMinimum: false,
    isWrongChain: false,
    noRoute: false,
    belowDust: false,
    quoted: 90n,
    minOut: 89n,
    hasWalletProvider: true,
  };

  it("passes a complete pour-back", () => {
    expect(withdrawGate(ready)).toEqual({ kind: "ready" });
  });

  it("asks for a bigger pour-back after the cup's balance, before the network", () => {
    expect(withdrawGate({ ...ready, belowMinimum: true }).kind).toBe("belowMinimum");
    expect(
      withdrawGate({ ...ready, belowMinimum: true, buildAmount: 300n }).kind,
    ).toBe("insufficient");
    expect(
      withdrawGate({ ...ready, belowMinimum: true, isWrongChain: true }).kind,
    ).toBe("belowMinimum");
  });

  it("distinguishes a bad custom address from a missing destination wallet", () => {
    expect(
      withdrawGate({ ...ready, recipient: undefined, usingCustomRecipient: true }).kind,
    ).toBe("invalidRecipient");
    expect(
      withdrawGate({ ...ready, recipient: undefined, usingCustomRecipient: false }).kind,
    ).toBe("connectDestination");
  });

  it("walks the ladder in actionable order", () => {
    expect(withdrawGate({ ...ready, address: undefined }).kind).toBe("connectSource");
    expect(withdrawGate({ ...ready, hasDestination: false }).kind).toBe("pickDestination");
    expect(withdrawGate({ ...ready, buildAmount: undefined }).kind).toBe("enterAmount");
    expect(withdrawGate({ ...ready, buildAmount: 300n }).kind).toBe("insufficient");
    expect(withdrawGate({ ...ready, isWrongChain: true }).kind).toBe("wrongChain");
    expect(withdrawGate({ ...ready, noRoute: true }).kind).toBe("noRoute");
    expect(withdrawGate({ ...ready, belowDust: true }).kind).toBe("belowDust");
    expect(withdrawGate({ ...ready, minOut: undefined }).kind).toBe("quotePending");
  });
});
