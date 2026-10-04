import { describe, expect, it, vi } from "vitest";
import { ChainKeys, EvmSolverService, Sodax, SolverApiService } from "@sodax/sdk";
import { PARTNER_FEE, sodaxConfig } from "./sodax-config";
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
  slippagePctFor,
  pourAmounts,
  quoteAmountFor,
  swapInputFor,
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

describe("the partner fee, taken exactly once", () => {
  // $100 of a 6-decimal stablecoin; PARTNER_FEE is 40 bps.
  const build = 100_000_000n;
  const sodax = new Sodax(sodaxConfig);

  it("swaps the build amount less 0.4%", () => {
    expect(swapInputFor(build)).toBe(99_600_000n);
    expect(swapInputFor(undefined)).toBeUndefined();
    expect(swapInputFor(0n)).toBeUndefined();
  });

  it("asks the quote for the pre-fee amount, untouched", () => {
    expect(quoteAmountFor(build)).toBe(build);
    expect(quoteAmountFor(undefined)).toBeUndefined();
    expect(quoteAmountFor(0n)).toBeUndefined();
  });

  it("the intent takes the same fee once: the full amount leaves, the rest is swapped", () => {
    // What createVaultIntent builds on a spoke: the deposit carries
    // `inputAmount` (the build amount), the intent swaps it less the fee.
    const params = {
      inputToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      outputToken: "0x2D5D2250EE426cA318efBd03ddf926B23c96f74B",
      inputAmount: build,
      minOutputAmount: 1n,
      deadline: 0n,
      allowPartialFill: false,
      srcChainKey: ChainKeys.BASE_MAINNET,
      dstChainKey: ChainKeys.SONIC_MAINNET,
      srcAddress: "0x1111111111111111111111111111111111111111",
      dstAddress: "0x2222222222222222222222222222222222222222",
      solver: "0x0000000000000000000000000000000000000000",
      data: "0x",
    } as const;
    const [, intent, feeAmount] = EvmSolverService.constructCreateIntentData(
      params,
      "0x3333333333333333333333333333333333333333",
      sodax.config,
      sodax.config.swapPartnerFee,
    );
    expect(sodax.config.swapPartnerFee).toEqual(PARTNER_FEE);
    expect(feeAmount).toBe(400_000n);
    expect(intent.inputAmount).toBe(swapInputFor(build));
    expect(intent.minOutputAmount).toBe(1n);
  });

  it("the quote takes the pre-fee amount: the SDK deducts the fee itself", async () => {
    // Read the amount the solver is really asked for, with no network.
    const asked: bigint[] = [];
    const spy = vi
      .spyOn(SolverApiService, "getQuote")
      .mockImplementation(async (payload) => {
        asked.push(payload.amount);
        return { ok: true, value: { quoted_amount: payload.amount * 2n } };
      });
    try {
      const quote = await sodax.swaps.getQuote({
        token_src: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        token_src_blockchain_id: ChainKeys.BASE_MAINNET,
        token_dst: "0x2D5D2250EE426cA318efBd03ddf926B23c96f74B",
        token_dst_blockchain_id: ChainKeys.SONIC_MAINNET,
        amount: quoteAmountFor(build)!,
        quote_type: "exact_input",
      });
      // Asked for exactly what the intent swaps: the fee came off once.
      expect(asked).toEqual([swapInputFor(build)]);
      expect(quote.ok && quote.value.quoted_amount).toBe(199_200_000n);
      // The minimum sits the app's 0.5% under what the swapped amount buys.
      expect(minReceivedFor(199_200_000n)).toBe(198_204_000n);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("slippage by signing chain", () => {
  it("keeps 0.5% for fast sources and gives a Bitcoin signed order 1.5%", () => {
    expect(slippagePctFor(ChainKeys.BASE_MAINNET)).toBe(0.5);
    expect(slippagePctFor(ChainKeys.SOLANA_MAINNET)).toBe(0.5);
    expect(slippagePctFor(ChainKeys.SONIC_MAINNET)).toBe(0.5);
    expect(slippagePctFor(undefined)).toBe(0.5);
    expect(slippagePctFor(ChainKeys.BITCOIN_MAINNET)).toBe(1.5);
  });

  it("sets the intent minimum from the signing chain's tolerance", () => {
    expect(minReceivedFor(10_000n, ChainKeys.BASE_MAINNET)).toBe(9_950n);
    expect(minReceivedFor(10_000n, ChainKeys.BITCOIN_MAINNET)).toBe(9_850n);
    expect(minReceivedFor(10_000n)).toBe(9_950n);
    expect(minReceivedFor(undefined, ChainKeys.BITCOIN_MAINNET)).toBeUndefined();
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
  it("is a dollar fifty in USD", () => {
    expect(minPourUsd(1)).toBe(1.5);
    expect(belowMinimum(1.49)).toBe(true);
    expect(belowMinimum(1.5)).toBe(false);
  });

  it("rounds up to a half unit of the display currency", () => {
    // €0.86 per dollar: $1.50 is €1.29, so the floor becomes €1.50, which is $1.744.
    expect(minPourUsd(0.86)).toBeCloseTo(1.5 / 0.86);
    expect(belowMinimum(1.7, 0.86)).toBe(true);
    expect(belowMinimum(1.75, 0.86)).toBe(false);
    // ¥150 per dollar: ¥225 is exactly a dollar fifty.
    expect(minPourUsd(150)).toBe(1.5);
  });

  it("treats an unsettled rate as USD", () => {
    expect(minPourUsd(0)).toBe(1.5);
    expect(minPourUsd(Number.NaN)).toBe(1.5);
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

  it("cups never wait on the account: an omitted account is ready", () => {
    expect(depositGate({ ...ready, account: "ready" })).toEqual({ kind: "ready" });
  });

  it("a buy with no shelf to land on is refused before anything else", () => {
    // Even with no token picked, sign-in is the first door: every other
    // reason is fixable inside the drawer, this one is not.
    expect(depositGate({ ...ready, hasToken: false, account: "none" }).kind).toBe(
      "noAccount",
    );
    expect(depositGate({ ...ready, account: "none" }).kind).toBe("noAccount");
  });

  it("a shelf still deriving only holds the door at the very end", () => {
    expect(depositGate({ ...ready, account: "deriving" }).kind).toBe(
      "accountPending",
    );
    // Every field-level reason still wins over the wait.
    expect(depositGate({ ...ready, account: "deriving", buildAmount: undefined }).kind).toBe(
      "enterAmount",
    );
    expect(depositGate({ ...ready, account: "deriving", noRoute: true }).kind).toBe(
      "noRoute",
    );
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
    // Signed in on a pocketed session, wallet away: the button opens it.
    expect(depositGate({ ...ready, hasWalletProvider: false, walletAsleep: true }).kind).toBe("wakeWallet");
    expect(depositGate({ ...ready, walletAsleep: true }).kind).toBe("ready");
    expect(depositGate({ ...ready, hasWalletProvider: false, walletAsleep: true, buildAmount: 300n }).kind).toBe("insufficient");
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
    expect(withdrawGate({ ...ready, hasWalletProvider: false, walletAsleep: true }).kind).toBe("wakeWallet");
  });
});

describe("the gas gate in the order gates", () => {
  const buy = {
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
  const sell = {
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

  it("stops a buy whose chain cannot pay its fee, right after the balance", () => {
    expect(depositGate({ ...buy, gasShort: true }).kind).toBe("needsGas");
    // Asking for more than the wallet holds is still the first thing said.
    expect(depositGate({ ...buy, gasShort: true, buildAmount: 300n }).kind).toBe("insufficient");
    expect(depositGate({ ...buy, gasShort: false }).kind).toBe("ready");
  });

  it("stops a sell the same way", () => {
    expect(withdrawGate({ ...sell, gasShort: true }).kind).toBe("needsGas");
    expect(withdrawGate({ ...sell, gasShort: true, buildAmount: 300n }).kind).toBe("insufficient");
    expect(withdrawGate(sell).kind).toBe("ready");
  });
});

describe("Max sells exactly what is held", () => {
  // David's NVDA sell of 4 Oct 2026: 0.011016273649717106 shares held.
  const held = 11_016_273_649_717_106n;
  const price = 229.2; // per share, in the display currency

  it("in money mode, Max of 0.011016273649717106 sells exactly that", () => {
    const text = amountText(held, 18, true, price);
    const { buildAmount, moneyMode } = pourAmounts(text, "money", 18, price, { text, amount: held });
    expect(moneyMode).toBe(true);
    expect(buildAmount).toBe(held);
  });

  it("without the Max mark the same cents left a sliver behind (the old dust)", () => {
    const text = amountText(held, 18, true, price);
    const { buildAmount } = pourAmounts(text, "money", 18, price);
    expect(buildAmount).toBeLessThan(held);
    expect(held - buildAmount!).toBeGreaterThan(0n);
  });

  it("in share mode, Max is exact too", () => {
    const text = amountText(held, 18, false, price);
    expect(text).toBe("0.011016273649717106");
    expect(pourAmounts(text, "token", 18, price, { text, amount: held }).buildAmount).toBe(held);
  });

  it("once the text is changed, it is read as typed", () => {
    const text = amountText(held, 18, true, price);
    const { buildAmount } = pourAmounts("1.00", "money", 18, price, { text, amount: held });
    expect(buildAmount).toBeLessThan(held);
    expect(buildAmount).not.toBe(held);
  });

  it("a Max with nothing held means nothing", () => {
    expect(pourAmounts("0.00", "money", 18, price, { text: "0.00", amount: 0n }).buildAmount).toBeUndefined();
  });
});

describe("Max is the holding seen when it was pressed", () => {
  const seen = 11_016_273_649_717_106n;
  const price = 229.2;
  const text = amountText(seen, 18, true, price);
  const ready = {
    address: "0xabc",
    hasDestination: true,
    recipient: "0xdef",
    usingCustomRecipient: false,
    belowMinimum: false,
    isWrongChain: false,
    noRoute: false,
    belowDust: false,
    quoted: 90n,
    minOut: 89n,
    hasWalletProvider: true,
  };

  it("a holding that grows afterwards does not grow the order", () => {
    const grown = seen * 3n;
    const { buildAmount } = pourAmounts(text, "money", 18, price, { text, amount: seen });
    expect(buildAmount).toBe(seen);
    expect(withdrawGate({ ...ready, buildAmount: buildAmount!, availableShares: grown })).toEqual({ kind: "ready" });
  });

  it("a holding that shrinks afterwards is refused, never sold short of what is shown", () => {
    const { buildAmount } = pourAmounts(text, "money", 18, price, { text, amount: seen });
    expect(withdrawGate({ ...ready, buildAmount: buildAmount!, availableShares: seen - 1n })).toEqual({ kind: "insufficient" });
  });
});
