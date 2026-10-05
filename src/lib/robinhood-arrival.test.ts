import { describe, expect, it } from "vitest";
import { arrivalState } from "./robinhood-arrival";

const base = { enabled: true, deliveryTx: undefined, balance: undefined, baseline: undefined, waitedOut: false };

describe("arrivalState", () => {
  it("is off for any order that is not a filled Robinhood Chain buy", () => {
    expect(arrivalState({ ...base, enabled: false, deliveryTx: "0xabc" })).toEqual({ kind: "off" });
  });

  it("is arriving after the fill until a sign is seen", () => {
    expect(arrivalState(base)).toEqual({ kind: "arriving" });
    expect(arrivalState({ ...base, balance: 5n, baseline: 5n })).toEqual({ kind: "arriving" });
  });

  it("is arrived once the relay names the delivery transaction", () => {
    expect(arrivalState({ ...base, deliveryTx: "0xdead" })).toEqual({ kind: "arrived", deliveryTx: "0xdead" });
  });

  it("is arrived once the wallet holds more of the token than before the order", () => {
    expect(arrivalState({ ...base, balance: 6n, baseline: 5n })).toEqual({ kind: "arrived" });
  });

  it("never reads a balance without a baseline as an arrival", () => {
    expect(arrivalState({ ...base, balance: 6n })).toEqual({ kind: "arriving" });
  });

  it("is slow, not failed, when neither sign comes inside the wait", () => {
    expect(arrivalState({ ...base, waitedOut: true })).toEqual({ kind: "slow" });
    expect(arrivalState({ ...base, waitedOut: true, deliveryTx: "0xdead" })).toEqual({ kind: "arrived", deliveryTx: "0xdead" });
  });
});
