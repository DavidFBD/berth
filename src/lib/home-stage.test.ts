import { describe, expect, it } from "vitest";
import { hasMoneyAside, homeStage, parseHomeStage, NUDGES_SAID_BY_STEP, type FundsRead } from "@/lib/home-stage";
import { MIN_ORDER_USD } from "@/lib/order-minimum";

const read = (over: Partial<FundsRead> = {}): FundsRead => ({
  connected: true,
  unaddressedChains: 0,
  isLoading: false,
  erroredChains: 0,
  holdings: [],
  totalUsd: undefined,
  ...over,
});
const priced = (usd: number, over: Partial<FundsRead> = {}) => read({ holdings: [{ usdValue: usd }], totalUsd: usd, ...over });
const decide = (
  funds: FundsRead,
  over: { ownsStock?: boolean; holdingsSettled?: boolean; waitedOut?: boolean } = {},
) => homeStage({ holdingsSettled: true, ownsStock: false, funds, ...over });
const WAIT = { stage: undefined, proven: false };

describe("homeStage", () => {
  it("is empty, and proven, when every network was read and nothing is there", () => {
    expect(decide(read())).toEqual({ stage: "empty", proven: true });
  });
  it("is funded from the order minimum up", () => {
    expect(decide(priced(MIN_ORDER_USD))).toEqual({ stage: "funded", proven: true });
    expect(decide(priced(25))).toEqual({ stage: "funded", proven: true });
  });
  it("is empty below the order minimum, since no order could be placed", () => {
    expect(decide(priced(0.8)).stage).toBe("empty");
    expect(decide(priced(MIN_ORDER_USD - 0.01)).stage).toBe("empty");
  });
  it("calls an unpriced asset funded, never empty", () => {
    expect(decide(read({ holdings: [{ usdValue: undefined }] }))).toEqual({ stage: "funded", proven: true });
  });
  it("owns once any stock or fund is held, whatever the funds say", () => {
    expect(decide(read({ isLoading: true }), { ownsStock: true })).toEqual({ stage: "owns", proven: true });
  });

  describe("waits, never reads $0", () => {
    it("while the holdings, on every linked wallet, are read", () => {
      expect(decide(priced(40), { holdingsSettled: false })).toEqual(WAIT);
    });
    it("while the funds load", () => {
      expect(decide(read({ isLoading: true }))).toEqual(WAIT);
    });
    it("before any wallet has an address", () => {
      expect(decide(read({ connected: false }))).toEqual(WAIT);
    });
    it("while an email session's Solana wallet has no address yet", () => {
      expect(decide(read({ unaddressedChains: 1 }))).toEqual(WAIT);
      expect(decide(priced(0.5, { unaddressedChains: 1 }))).toEqual(WAIT);
    });
  });

  it("does not wait for a missing address when what was read already proves money", () => {
    expect(decide(priced(30, { unaddressedChains: 1 }))).toEqual({ stage: "funded", proven: true });
  });

  it("after the bounded wait, decides from what was read and does not remember it", () => {
    expect(decide(read({ unaddressedChains: 1 }), { waitedOut: true })).toEqual({ stage: "empty", proven: false });
    expect(decide(read({ connected: false }), { waitedOut: true })).toEqual({ stage: "empty", proven: false });
  });

  describe("with networks that could not be read", () => {
    it("shows the real step for what was read, so a new account gets Add money, and does not remember it", () => {
      expect(decide(read({ erroredChains: 1 }))).toEqual({ stage: "empty", proven: false });
      expect(decide(priced(0.4, { erroredChains: 1 }))).toEqual({ stage: "empty", proven: false });
    });
    it("is still funded, and proven, when what was read is enough", () => {
      expect(decide(priced(30, { erroredChains: 2 }))).toEqual({ stage: "funded", proven: true });
    });
  });
});

describe("hasMoneyAside", () => {
  it("counts parked cash and money waiting in an order", () => {
    expect(hasMoneyAside({ holdsCash: true, waitingOrders: false })).toBe(true);
    expect(hasMoneyAside({ holdsCash: false, waitingOrders: true })).toBe(true);
    expect(hasMoneyAside({ holdsCash: false, waitingOrders: false })).toBe(false);
  });
});

describe("parseHomeStage", () => {
  it("reads back only a known stage", () => {
    expect(parseHomeStage("owns")).toBe("owns");
    expect(parseHomeStage("1")).toBeUndefined();
    expect(parseHomeStage(null)).toBeUndefined();
  });
});

describe("NUDGES_SAID_BY_STEP", () => {
  it("never hides news about a holding", () => {
    for (const kinds of Object.values(NUDGES_SAID_BY_STEP)) expect(kinds).not.toContain("heldNews");
  });
});
