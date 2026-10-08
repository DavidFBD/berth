import { describe, expect, it } from "vitest";
import { ChainKeys } from "@sodax/sdk";
import { COPY } from "@/lib/copy";
import { gasShortMessage, shortfallProp, trackGasBlocked } from "./gas-message";
import { cleanProps } from "./analytics";

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

describe("the gas_blocked event", () => {
  it("carries the side, the chain and the shortfall, and nothing personal survives the allowlist", () => {
    expect(shortfallProp(340_000_000_000_000n, 18)).toBe("0.00034");
    expect(shortfallProp(undefined, 18)).toBe("unknown");
    expect(
      cleanProps("gas_blocked", { side: "sell", chain: ChainKeys.BASE_MAINNET, shortfall: "0.00034", address: "0xE0000000000000000000000000000000000000dd" }),
    ).toEqual({ side: "sell", chain: ChainKeys.BASE_MAINNET, shortfall: "0.00034" });
  });
});

describe("trackGasBlocked", () => {
  it("sends one block once, whether the drawer or the last check reports it first", () => {
    const props = { side: "buy" as const, chain: ChainKeys.ARBITRUM_MAINNET, shortfall: "0.00001" };
    expect(trackGasBlocked(props, 1_000)).toBe(true);
    expect(trackGasBlocked(props, 30_000)).toBe(false);
    expect(trackGasBlocked({ ...props, side: "sell" }, 30_000)).toBe(true);
    expect(trackGasBlocked(props, 62_000)).toBe(true);
  });
});
