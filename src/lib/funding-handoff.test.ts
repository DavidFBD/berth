import { describe, expect, it } from "vitest";
import {
  MIN_ARRIVAL_UNITS,
  SLOW_AFTER_MS,
  STOP_AFTER_MS,
  arrivalView,
  fundingOutcome,
  handoffTarget,
  moneyStepOffer,
  stillWatching,
  usdcToUsd,
} from "./funding-handoff";

const T0 = 1_000_000;

describe("fundingOutcome", () => {
  it("treats every answer Privy resolves with as sent", () => {
    expect(fundingOutcome({ method: "fiat", status: "submitted" })).toBe("sent");
    expect(fundingOutcome({ method: "fiat", status: "confirmed" })).toBe("sent");
    expect(fundingOutcome({ method: "crypto", status: "completed" })).toBe("sent");
  });
  it("treats no answer, or one that says nothing went through, as closed", () => {
    expect(fundingOutcome(undefined)).toBe("closed");
    expect(fundingOutcome(null)).toBe("closed");
    expect(fundingOutcome({ status: "cancelled" })).toBe("closed");
    expect(fundingOutcome({ status: "Failed" })).toBe("closed");
  });
  it("waits rather than misses money when the status is unfamiliar", () => {
    expect(fundingOutcome({ method: "fiat" })).toBe("sent");
    expect(fundingOutcome({ status: "pending" })).toBe("sent");
  });
});

describe("arrivalView", () => {
  it("waits while no read has answered", () => {
    expect(arrivalView({ baseline: 0n, current: undefined, startedAt: T0, now: T0 + 1000 })).toEqual({ kind: "waiting", slow: false });
  });
  it("waits while the balance has not risen", () => {
    expect(arrivalView({ baseline: 5_000_000n, current: 5_000_000n, startedAt: T0, now: T0 })).toEqual({ kind: "waiting", slow: false });
    // Spent meanwhile: lower is not an arrival.
    expect(arrivalView({ baseline: 5_000_000n, current: 1_000_000n, startedAt: T0, now: T0 }).kind).toBe("waiting");
  });
  it("arrives with what the balance rose by", () => {
    expect(arrivalView({ baseline: 2_000_000n, current: 12_000_000n, startedAt: T0, now: T0 })).toEqual({ kind: "arrived", amount: 10_000_000n });
  });
  it("without a baseline, arrives only once the balance holds an order's minimum", () => {
    expect(arrivalView({ baseline: undefined, current: MIN_ARRIVAL_UNITS - 1n, startedAt: T0, now: T0 }).kind).toBe("waiting");
    expect(arrivalView({ baseline: undefined, current: MIN_ARRIVAL_UNITS, startedAt: T0, now: T0 })).toEqual({ kind: "arrived", amount: MIN_ARRIVAL_UNITS });
  });
  it("says it is slow after SLOW_AFTER_MS and stops after STOP_AFTER_MS", () => {
    expect(arrivalView({ baseline: 0n, current: 0n, startedAt: T0, now: T0 + SLOW_AFTER_MS - 1 })).toEqual({ kind: "waiting", slow: false });
    expect(arrivalView({ baseline: 0n, current: 0n, startedAt: T0, now: T0 + SLOW_AFTER_MS })).toEqual({ kind: "waiting", slow: true });
    expect(arrivalView({ baseline: 0n, current: 0n, startedAt: T0, now: T0 + STOP_AFTER_MS })).toEqual({ kind: "stopped" });
  });
  it("still sees money that lands after the slow line", () => {
    expect(arrivalView({ baseline: 0n, current: 10_000_000n, startedAt: T0, now: T0 + SLOW_AFTER_MS * 2 }).kind).toBe("arrived");
  });
  it("reads the balance only while waiting", () => {
    expect(stillWatching({ kind: "waiting", slow: true })).toBe(true);
    expect(stillWatching({ kind: "stopped" })).toBe(false);
    expect(stillWatching({ kind: "arrived", amount: 1n })).toBe(false);
  });
});

describe("handoffTarget", () => {
  it("reopens the order that asked for the money", () => {
    expect(handoffTarget({ hasListing: true, canBuy: true })).toBe("buy");
  });
  it("offers a choice when no order asked", () => {
    expect(handoffTarget({ hasListing: false, canBuy: true })).toBe("choose");
  });
  it("never leads to a buy where Berth takes no order", () => {
    expect(handoffTarget({ hasListing: true, canBuy: false })).toBe("none");
    expect(handoffTarget({ hasListing: false, canBuy: false })).toBe("none");
  });
});

describe("usdcToUsd", () => {
  it("reads six decimals", () => {
    expect(usdcToUsd(10_500_000n)).toBe(10.5);
  });
});

describe("moneyStepOffer", () => {
  it("offers the card first to an email account whose wallet exists", () => {
    expect(moneyStepOffer({ walletAccount: false, canPayByCard: true, aside: false })).toBe("card");
  });
  it("opens Add money while the wallet is still being made, or when money set aside is named first", () => {
    expect(moneyStepOffer({ walletAccount: false, canPayByCard: false, aside: false })).toBe("drawer");
    expect(moneyStepOffer({ walletAccount: false, canPayByCard: true, aside: true })).toBe("drawer");
  });
  it("never offers a wallet account Privy's card window", () => {
    expect(moneyStepOffer({ walletAccount: true, canPayByCard: true, aside: false })).toBe("wallet");
  });
});
