import { describe, expect, it } from "vitest";
import {
  PRICE_DECIMALS,
  dayOf,
  effectivePrice,
  endOfDay,
  fillProgress,
  fillsNow,
  limitDeadline,
  limitMinOutput,
  limitProblem,
  limitStateFrom,
  limitTokenOk,
  parseLimitPrice,
  pastDeadline,
  priceFromNumber,
  priceText,
  switchedOn,
  type IntentRecord,
} from "./limit-orders";

const P = (dollars: string) => parseLimitPrice(dollars)!;

describe("parseLimitPrice", () => {
  it("reads plain, dollar and comma prices into eight decimals", () => {
    expect(parseLimitPrice("200")).toBe(200n * 10n ** BigInt(PRICE_DECIMALS));
    expect(parseLimitPrice("$1,250.5")).toBe(125_050_000_000n);
    expect(parseLimitPrice(".5")).toBe(50_000_000n);
    expect(parseLimitPrice("0.00000001")).toBe(1n);
  });

  it("refuses zero, junk, negatives and more precision than it can carry", () => {
    for (const bad of ["", "0", "0.00", "abc", "-5", "1.2.3", "0.000000001", undefined, null]) {
      expect(parseLimitPrice(bad as string)).toBeUndefined();
    }
  });

  it("round trips through priceText and priceFromNumber", () => {
    expect(priceText(P("200"))).toBe("200");
    expect(priceText(P("199.95"))).toBe("199.95");
    expect(priceFromNumber(215.304)).toBe(P("215.30"));
    expect(priceFromNumber(0)).toBeUndefined();
    expect(priceFromNumber(Number.NaN)).toBeUndefined();
  });
});

describe("limitMinOutput", () => {
  it("a buy: dollars over price, in the listing's 18 decimals", () => {
    // 50 USDC (6dp) at $200 is exactly 0.25 NVDA.
    expect(limitMinOutput({ side: "buy", swapInput: 50_000_000n, inputDecimals: 6, outputDecimals: 18, price: P("200") })).toBe(
      250_000_000_000_000_000n,
    );
  });

  it("a sell: shares times price, in the stablecoin's 6 decimals", () => {
    // 0.25 NVDA at $250 is exactly 62.5 USDC.
    expect(limitMinOutput({ side: "sell", swapInput: 250_000_000_000_000_000n, inputDecimals: 18, outputDecimals: 6, price: P("250") })).toBe(
      62_500_000n,
    );
  });

  it("rounds up, in the person's favour, whenever the division is not exact", () => {
    // 1 USDC at $3: 0.333… shares, rounded up to the next wei.
    const buy = limitMinOutput({ side: "buy", swapInput: 1_000_000n, inputDecimals: 6, outputDecimals: 18, price: P("3") })!;
    expect(buy).toBe(333_333_333_333_333_334n);
    expect(buy * 3n).toBeGreaterThanOrEqual(10n ** 18n);
    // 1 wei of a share at $0.01 is far under a cent: still at least 1 unit out.
    expect(limitMinOutput({ side: "sell", swapInput: 1n, inputDecimals: 18, outputDecimals: 6, price: P("0.01") })).toBe(1n);
    // 0.333333 shares (18dp) at $1.5 = 0.4999995 USDC, rounded up to 0.5.
    expect(
      limitMinOutput({ side: "sell", swapInput: 333_333_000_000_000_000n, inputDecimals: 18, outputDecimals: 6, price: P("1.5") }),
    ).toBe(500_000n);
  });

  it("works across other decimal pairs (18dp stablecoin in, 18dp listing out)", () => {
    expect(limitMinOutput({ side: "buy", swapInput: 10n ** 20n, inputDecimals: 18, outputDecimals: 18, price: P("400") })).toBe(
      250_000_000_000_000_000n,
    );
  });

  it("is undefined without an amount or a price", () => {
    expect(limitMinOutput({ side: "buy", swapInput: undefined, inputDecimals: 6, outputDecimals: 18, price: P("1") })).toBeUndefined();
    expect(limitMinOutput({ side: "buy", swapInput: 0n, inputDecimals: 6, outputDecimals: 18, price: P("1") })).toBeUndefined();
    expect(limitMinOutput({ side: "buy", swapInput: 5n, inputDecimals: 6, outputDecimals: 18, price: undefined })).toBeUndefined();
  });

  it("never pays worse than the named price", () => {
    for (const [input, price] of [
      [49_800_000n, "213.37"],
      [1_234_567n, "0.77"],
      [999_999_999n, "12345.678"],
    ] as const) {
      const out = limitMinOutput({ side: "buy", swapInput: input, inputDecimals: 6, outputDecimals: 18, price: P(price) })!;
      expect(effectivePrice({ side: "buy", swapInput: input, minOutput: out, inputDecimals: 6, outputDecimals: 18 })).toBeLessThanOrEqual(
        Number(price) + 1e-9,
      );
    }
  });
});

describe("expiry", () => {
  it("until cancelled is deadline 0", () => {
    expect(limitDeadline({ kind: "never" })).toBe(0n);
  });

  it("a date is the end of that local day, in unix seconds", () => {
    const end = new Date(2026, 9, 3, 23, 59, 59);
    expect(endOfDay("2026-10-03")?.getTime()).toBe(end.getTime());
    expect(limitDeadline({ kind: "date", day: "2026-10-03" })).toBe(BigInt(Math.floor(end.getTime() / 1000)));
    expect(dayOf(end)).toBe("2026-10-03");
  });

  it("refuses a malformed or impossible day", () => {
    expect(endOfDay("2026-02-30")).toBeUndefined();
    expect(endOfDay("03/10/2026")).toBeUndefined();
    expect(limitDeadline({ kind: "date", day: "soon" })).toBeUndefined();
  });

  it("names the one problem: price first, then the date", () => {
    const now = new Date(2026, 8, 28, 12);
    expect(limitProblem({ price: undefined, expiry: { kind: "never" }, now })).toBe("enterPrice");
    expect(limitProblem({ price: P("1"), expiry: { kind: "date", day: "" }, now })).toBe("pickDate");
    expect(limitProblem({ price: P("1"), expiry: { kind: "date", day: "2026-09-27" }, now })).toBe("pastDate");
    expect(limitProblem({ price: P("1"), expiry: { kind: "date", day: "2028-01-01" }, now })).toBe("tooFar");
    expect(limitProblem({ price: P("1"), expiry: { kind: "date", day: "2026-09-28" }, now })).toBeNull();
    expect(limitProblem({ price: P("1"), expiry: { kind: "never" }, now })).toBeNull();
  });

  it("knows a waiting order past its deadline", () => {
    const now = new Date("2026-10-01T00:00:00Z");
    expect(pastDeadline(null, now)).toBe(false);
    expect(pastDeadline("2026-09-30T23:59:59Z", now)).toBe(true);
    expect(pastDeadline(new Date("2026-10-02T00:00:00Z"), now)).toBe(false);
  });
});

describe("fillsNow and the pay token", () => {
  it("a buy at or above the market, or a sell at or below it, would fill right away", () => {
    expect(fillsNow("buy", P("200"), 215)).toBe(false);
    expect(fillsNow("buy", P("220"), 215)).toBe(true);
    expect(fillsNow("sell", P("250"), 215)).toBe(false);
    expect(fillsNow("sell", P("210"), 215)).toBe(true);
    expect(fillsNow("buy", P("210"), undefined)).toBe(false);
  });

  it("prices only in dollar stablecoins on EVM networks", () => {
    expect(limitTokenOk({ symbol: "USDC" }, true)).toBe(true);
    expect(limitTokenOk({ symbol: "usdt" }, true)).toBe(true);
    expect(limitTokenOk({ symbol: "ETH" }, true)).toBe(false);
    expect(limitTokenOk({ symbol: "USDC" }, false)).toBe(false);
    expect(limitTokenOk(null, true)).toBe(false);
  });
});

describe("limitStateFrom", () => {
  const base = (over: Partial<IntentRecord> = {}): IntentRecord => ({
    open: true,
    intent: { deadline: "0", inputAmount: "1000" },
    events: [],
    ...over,
  });
  const now = new Date("2026-10-01T00:00:00Z");

  it("no record yet is nothing to say", () => {
    expect(limitStateFrom(null)).toBeNull();
  });

  it("open with no fill rests", () => {
    expect(limitStateFrom(base(), { now })).toEqual({ status: "resting", remainingInput: 1000n, receivedOutput: 0n, fillTx: undefined });
  });

  it("a fill that leaves nothing is filled, with its transaction", () => {
    const state = limitStateFrom(
      base({
        open: false,
        events: [{ eventType: "intent-filled", txHash: "0xfill", intentState: { remainingInput: "0", receivedOutput: "928625" } }],
      }),
      { now },
    );
    expect(state).toEqual({ status: "filled", remainingInput: 0n, receivedOutput: 928625n, fillTx: "0xfill" });
  });

  it("a fill that leaves some while open is partial", () => {
    const state = limitStateFrom(
      base({ events: [{ eventType: "intent-filled", txHash: "0xa", intentState: { remainingInput: "400", receivedOutput: "6" } }] }),
      { now },
    );
    expect(state?.status).toBe("partial");
    expect(fillProgress(1000n, state!.remainingInput)).toBe(0.6);
  });

  it("a cancel is cancelled, or expired when the deadline passed and nobody asked", () => {
    const cancelled = base({ open: false, events: [{ eventType: "intent-cancelled", txHash: "0xc" }] });
    expect(limitStateFrom(cancelled, { now })?.status).toBe("cancelled");
    expect(limitStateFrom(cancelled, { now })?.closeTx).toBe("0xc");
    const lapsed = { ...cancelled, intent: { deadline: String(Math.floor(now.getTime() / 1000) - 60), inputAmount: "1000" } };
    expect(limitStateFrom(lapsed, { now })?.status).toBe("expired");
    expect(limitStateFrom(lapsed, { now, cancelAsked: true })?.status).toBe("cancelled");
    // A deadline still ahead: the person's own cancel, whatever they asked.
    const ahead = { ...cancelled, intent: { deadline: String(Math.floor(now.getTime() / 1000) + 3600), inputAmount: "1000" } };
    expect(limitStateFrom(ahead, { now })?.status).toBe("cancelled");
  });

  it("partly filled then cancelled keeps what filled", () => {
    const state = limitStateFrom(
      base({
        open: false,
        events: [
          { eventType: "intent-filled", txHash: "0xa", intentState: { remainingInput: "500", receivedOutput: "5" } },
          { eventType: "intent-cancelled", txHash: "0xc" },
        ],
      }),
      { now },
    );
    expect(state).toMatchObject({ status: "cancelled", receivedOutput: 5n, remainingInput: 500n });
  });
});

describe("switchedOn", () => {
  const list = " 0xBE59d5bf40ac4a349bd748e0d7c19ef27ad3ca23 , 46b223cd-fac6-48df-be5c-011e4d0f74c8";

  it("matches a wallet or a user id, any case", () => {
    expect(switchedOn(list, ["0xbe59d5bf40ac4a349bd748e0d7c19ef27ad3ca23"])).toBe(true);
    expect(switchedOn(list, [null, "46B223CD-FAC6-48DF-BE5C-011E4D0F74C8"])).toBe(true);
  });

  it("switches nobody else on, and nobody at all when the list is empty", () => {
    expect(switchedOn(list, ["0x0000000000000000000000000000000000000001", "someone"])).toBe(false);
    expect(switchedOn(list, [null, undefined, ""])).toBe(false);
    expect(switchedOn("", ["0xbe59d5bf40ac4a349bd748e0d7c19ef27ad3ca23"])).toBe(false);
    expect(switchedOn(undefined, ["x"])).toBe(false);
    expect(switchedOn(" , ,", [""])).toBe(false);
  });
});

describe("limitCta", () => {
  it("reviews only when the token, the price, the date and the minimum are all there", async () => {
    const { limitCta } = await import("./limit-orders");
    expect(limitCta({ tokenOk: false, problem: null, minOut: 1n })).toBe("needsDollars");
    expect(limitCta({ tokenOk: true, problem: "pastDate", minOut: 1n })).toBe("pastDate");
    expect(limitCta({ tokenOk: true, problem: null, minOut: undefined })).toBe("enterPrice");
    expect(limitCta({ tokenOk: true, problem: null, minOut: 5n })).toBe("review");
  });
});

describe("a price through the market", () => {
  it("stops a buy more than 1% above today's price and a sell more than 1% below it", async () => {
    const { limitProblem, throughMarket } = await import("./limit-orders");
    expect(throughMarket("buy", P("2000"), 200)).toBe(true);
    expect(throughMarket("buy", P("202"), 200)).toBe(false);
    expect(throughMarket("buy", P("202.01"), 200)).toBe(true);
    expect(throughMarket("sell", P("20"), 200)).toBe(true);
    expect(throughMarket("sell", P("198"), 200)).toBe(false);
    expect(throughMarket("buy", P("2000"), undefined)).toBe(false);
    expect(limitProblem({ price: P("2000"), expiry: { kind: "never" }, side: "buy", marketPrice: 200 })).toBe("throughMarket");
    expect(limitProblem({ price: P("190"), expiry: { kind: "never" }, side: "buy", marketPrice: 200 })).toBeNull();
  });

  it("a closed record with a fill and no cancel is filled, even without state", () => {
    const state = limitStateFrom({ open: false, intent: { deadline: "0", inputAmount: "10" }, events: [{ eventType: "intent-filled", txHash: "0xf" }] });
    expect(state?.status).toBe("filled");
  });
});

describe("no live price", () => {
  it("refuses a limit rather than failing open", async () => {
    const { limitProblem } = await import("./limit-orders");
    expect(limitProblem({ price: P("1"), expiry: { kind: "never" }, side: "buy", marketPrice: undefined })).toBe("noPrice");
    expect(limitProblem({ price: P("1"), expiry: { kind: "never" }, side: "sell", marketPrice: Number.NaN })).toBe("noPrice");
    expect(limitProblem({ price: P("1"), expiry: { kind: "never" }, side: "buy", marketPrice: 0 })).toBe("noPrice");
  });
});

describe("waiting money", () => {
  it("counts a buy's unfilled dollars and a sell's unfilled shares at today's price", async () => {
    const { waitingUsd, accountTotalWith } = await import("./limit-orders");
    const orders = [
      { direction: "buy" as const, symbol: "NVDA", inputRaw: "49800000", inputDecimals: 6, progress: 0, paySymbol: "USDC" },
      { direction: "buy" as const, symbol: "TSLA", inputRaw: "100000000", inputDecimals: 6, progress: 0.4, paySymbol: "USDT" },
      { direction: "sell" as const, symbol: "AAPL", inputRaw: "500000000000000000", inputDecimals: 18, progress: 0 },
    ];
    const sum = waitingUsd(orders, (symbol) => (symbol === "AAPL" ? 300 : undefined));
    expect(sum.priced).toBe(true);
    expect(sum.usd).toBeCloseTo(49.8 + 60 + 150, 6);
    expect(waitingUsd(orders, () => undefined)).toEqual({ usd: expect.closeTo(109.8, 6), priced: false });
    expect(waitingUsd([], () => 1)).toEqual({ usd: 0, priced: true });
    // A buy not paid in a dollar coin is never counted at a dollar a unit.
    expect(waitingUsd([{ direction: "buy", symbol: "NVDA", inputRaw: "10000000000000000", inputDecimals: 18, progress: 0, paySymbol: "ETH" }], () => 1)).toEqual({
      usd: 0,
      priced: false,
    });
    // Holdings 100, cash 20, funds 30, waiting 109.8: the total is all four.
    expect(accountTotalWith([100, 20, 30, 109.8])).toBeCloseTo(259.8, 6);
    expect(accountTotalWith([100, undefined, 30, 0])).toBeUndefined();
  });
});
