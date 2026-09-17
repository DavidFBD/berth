import { describe, expect, it } from "vitest";
import {
  CANCELLED_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
  friendlyError,
  isSessionExpiredError,
} from "./error-copy";

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
