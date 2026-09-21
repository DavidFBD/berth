import { describe, expect, it } from "vitest";
import {
  CANCELLED_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
  friendlyError,
  gasShortfallText,
  insufficientGasError,
  isSessionExpiredError,
} from "./error-copy";
import { COPY } from "./copy";

/**
 * Issue #21's lesson, pinned down. Privy throws EIP-1193 4900
 * ("Disconnected") when its access token is missing at send time, viem
 * renders 4900 as "The Provider is disconnected from all chains", and the
 * SDK wraps the whole thing as INTENT_CREATION_FAILED. Read at face value,
 * that prose accuses the chain layer of a fault that belongs to the session,
 * which is exactly the wrong turn triage took. These tests exist so the
 * detection survives every layer of that wrapping.
 */
describe("isSessionExpiredError", () => {
  it("catches the numeric 4900 code the string-only extractor misses", () => {
    expect(isSessionExpiredError({ code: 4900 })).toBe(true);
  });

  it("catches 4900 however deeply the SDK has wrapped it", () => {
    const wrapped = { code: "INTENT_CREATION_FAILED", cause: { cause: { code: 4900 } } };
    expect(isSessionExpiredError(wrapped)).toBe(true);
  });

  it("catches viem's prose, since viem rewrites the code on the way out", () => {
    const viemShape = new Error("The Provider is disconnected from all chains.");
    expect(isSessionExpiredError(viemShape)).toBe(true);
  });

  it("leaves unrelated failures alone", () => {
    expect(isSessionExpiredError({ code: "RELAY_TIMEOUT" })).toBe(false);
    expect(isSessionExpiredError(new Error("Execution reverted: 0x"))).toBe(false);
    expect(isSessionExpiredError(undefined)).toBe(false);
    expect(isSessionExpiredError("a string")).toBe(false);
  });

  it("does not hang on a self-referencing cause chain", () => {
    const loop: { code: string; cause?: unknown } = { code: "X" };
    loop.cause = loop;
    expect(isSessionExpiredError(loop)).toBe(false);
  });
});

describe("friendlyError", () => {
  it("names a lapsed session instead of blaming the network", () => {
    const wrapped = { code: "INTENT_CREATION_FAILED", cause: { code: 4900 } };
    expect(friendlyError(wrapped, "The order did not go through. Try again.")).toBe(
      SESSION_EXPIRED_MESSAGE,
    );
  });

  it("still falls back for anything it cannot place", () => {
    const fallback = "Could not prepare the order. Please try again.";
    expect(friendlyError({ code: "SOMETHING_NEW" }, fallback)).toBe(fallback);
  });

  it("keeps a cancel a cancel, so it stays unreported", () => {
    expect(friendlyError({ code: "USER_REJECTED" }, "ignored")).toBe(
      CANCELLED_MESSAGE,
    );
  });
});

/**
 * Issue #23's lesson. A wallet that cannot pay its own fee is wrapped as
 * INTENT_CREATION_FAILED like everything else, so the user was told "the
 * order did not go through, try again" about the one failure where trying
 * again cannot work. The node's own line carries the numbers, and they are
 * the difference between "not enough" and a next action.
 */
describe("insufficientGasError", () => {
  const base = {
    symbol: "ETH",
    decimals: 18,
    network: "Base",
  };

  // Verbatim from issue #23, viem's prose over the node's line.
  const issue23 = new Error(
    [
      "SodaxError: The total cost (gas * gas fee + value) of executing this transaction exceeds the balance of the account.",
      "Details: insufficient funds for gas * price + value: have 743300593668700 want 975917986270590",
    ].join("\n"),
  );

  it("reads the shortfall out of the node's line", () => {
    expect(insufficientGasError(issue23)).toEqual({
      shortfall: 232617392601890n,
    });
  });

  it("catches viem's prose alone, without numbers to offer", () => {
    const prose = new Error(
      "The total cost (gas * gas fee + value) of executing this transaction exceeds the balance of the account.",
    );
    expect(insufficientGasError(prose)).toEqual({});
  });

  it("finds it however deeply the SDK has wrapped it", () => {
    const wrapped = {
      code: "INTENT_CREATION_FAILED",
      cause: { cause: { details: "insufficient funds for gas * price + value" } },
    };
    expect(insufficientGasError(wrapped)).toEqual({});
  });

  it("leaves unrelated failures alone", () => {
    expect(insufficientGasError({ code: "RELAY_TIMEOUT" })).toBeUndefined();
    expect(insufficientGasError(new Error("Execution reverted"))).toBeUndefined();
    expect(insufficientGasError(undefined)).toBeUndefined();
  });

  it("rounds the top up to something a person would type", () => {
    // 0.000232617392601890 ETH short, plus half again, to two figures.
    expect(gasShortfallText(232617392601890n, 18, "ETH")).toBe("0.00035 ETH");
  });

  it("tells the user what to add and where, not to try again", () => {
    const message = friendlyError(issue23, "The order did not go through. Try again.", base);
    expect(message).toContain("0.00035 ETH");
    expect(message).toContain("Base");
    expect(message).not.toContain("Try again");
  });

  it("still names the network when the node gave no numbers", () => {
    const prose = new Error("insufficient funds for gas * price + value");
    expect(friendlyError(prose, "fallback", base)).toBe(
      COPY.errNeedsGasUnknown("Base"),
    );
  });

  it("falls back where no native token is known for the chain", () => {
    const fallback = "The order did not go through. Try again.";
    expect(friendlyError(issue23, fallback)).toBe(fallback);
  });
});
