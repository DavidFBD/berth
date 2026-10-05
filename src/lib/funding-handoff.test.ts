import { describe, expect, it, vi } from "vitest";
import {
  ARRIVAL_THRESHOLD_UNITS,
  SLOW_AFTER_MS,
  STOP_AFTER_MS,
  arrivalView,
  fundingOutcome,
  nextLowest,
  offersPayAnotherWay,
  readBaseline,
  withTimeout,
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
  it("counts only a rise of at least ARRIVAL_THRESHOLD_UNITS as arrival", () => {
    expect(arrivalView({ baseline: 5_000_000n, current: 5_000_000n + ARRIVAL_THRESHOLD_UNITS - 1n, startedAt: T0, now: T0 }).kind).toBe("waiting");
    expect(arrivalView({ baseline: 5_000_000n, current: 5_000_000n + ARRIVAL_THRESHOLD_UNITS, startedAt: T0, now: T0 })).toEqual({
      kind: "arrived",
      amount: ARRIVAL_THRESHOLD_UNITS,
    });
  });
  it("never assumes without a baseline: a wallet that already holds money does not arrive at once", () => {
    expect(arrivalView({ baseline: undefined, current: 500_000_000n, startedAt: T0, now: T0 })).toEqual({ kind: "unknown" });
    expect(arrivalView({ baseline: undefined, current: undefined, startedAt: T0, now: T0 + STOP_AFTER_MS })).toEqual({ kind: "unknown" });
    expect(stillWatching({ kind: "unknown" })).toBe(false);
  });
  it("measures from the lowest read, so a spend meanwhile cannot hide the payment", () => {
    // 20 held, 15 spent on Base, then a 10 card payment lands: 15 now, below the baseline.
    const lowest = nextLowest(nextLowest(20_000_000n, 20_000_000n), 5_000_000n);
    expect(lowest).toBe(5_000_000n);
    expect(arrivalView({ baseline: 20_000_000n, lowest, current: 15_000_000n, startedAt: T0, now: T0 })).toEqual({
      kind: "arrived",
      amount: 10_000_000n,
    });
    // The spend alone is no arrival.
    expect(arrivalView({ baseline: 20_000_000n, lowest, current: 5_000_000n, startedAt: T0, now: T0 }).kind).toBe("waiting");
  });
  it("keeps the floor when a read is missing or higher", () => {
    expect(nextLowest(5n, undefined)).toBe(5n);
    expect(nextLowest(5n, 9n)).toBe(5n);
    expect(nextLowest(5n, 3n)).toBe(3n);
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

describe("paying another way while waiting", () => {
  it("is offered on every wait, so a refused card payment never holds the person there", () => {
    expect(offersPayAnotherWay({ kind: "waiting", slow: false })).toBe(true);
    expect(offersPayAnotherWay({ kind: "waiting", slow: true })).toBe(true);
    expect(offersPayAnotherWay({ kind: "stopped" })).toBe(true);
    expect(offersPayAnotherWay({ kind: "unknown" })).toBe(true);
    expect(offersPayAnotherWay({ kind: "arrived", amount: 1n })).toBe(false);
  });
});

describe("readBaseline", () => {
  const fast = { timeoutMs: 20, retryMs: 1 };
  it("takes the first read that answers", async () => {
    const read = vi.fn<() => Promise<bigint>>().mockRejectedValueOnce(new Error("rpc")).mockResolvedValueOnce(7n);
    await expect(readBaseline(read, fast)).resolves.toBe(7n);
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("gives up honestly after its tries, a hung read counting as failed", async () => {
    const read = vi.fn(() => new Promise<bigint>(() => {}));
    await expect(readBaseline(read, { ...fast, attempts: 3 })).resolves.toBeUndefined();
    expect(read).toHaveBeenCalledTimes(3);
  });
  it("caps one read with a timeout", async () => {
    await expect(withTimeout(new Promise(() => {}), 10)).rejects.toThrow();
    await expect(withTimeout(Promise.resolve(1), 10)).resolves.toBe(1);
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
