import { describe, expect, it } from "vitest";
import { ChainKeys } from "@sodax/sdk";
import { COPY } from "@/lib/copy";
import { gasShortMessage } from "./gas-message";

const ETH = { symbol: "ETH", decimals: 18 };

describe("gasShortMessage", () => {
  it("names the token, the network and the amount, in the house format", () => {
    expect(gasShortMessage(COPY, ETH, ChainKeys.BASE_MAINNET, 34_000_000_000_000n)).toBe(COPY.gasToAdd("0.000034", "ETH", "Base"));
    expect(gasShortMessage(COPY, ETH, ChainKeys.BASE_MAINNET, 1_200n * 10n ** 18n)).toBe(COPY.gasToAdd("1,200", "ETH", "Base"));
  });

  it("falls back to the plain need when no amount can be told", () => {
    expect(gasShortMessage(COPY, ETH, ChainKeys.BASE_MAINNET, undefined)).toBe(COPY.gasNeededToPay("ETH", "Base"));
  });

  it("speaks of cancelling for a cancel, never of an order starting", () => {
    const text = gasShortMessage(COPY, ETH, ChainKeys.BASE_MAINNET, 34_000_000_000_000n, "cancel");
    expect(text).toBe(COPY.gasToAddCancel("0.000034", "ETH", "Base"));
    expect(text).not.toContain("can start");
    expect(gasShortMessage(COPY, ETH, ChainKeys.BASE_MAINNET, undefined, "cancel")).toBe(COPY.gasNeededToCancel("ETH", "Base"));
  });

  it("asks to lower the amount when the typed amount is the cause", () => {
    expect(gasShortMessage(COPY, ETH, ChainKeys.BASE_MAINNET, 5n, "order", true)).toBe(COPY.gasLowerAmount("ETH", "Base"));
  });
});
