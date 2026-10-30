import { describe, expect, it } from "vitest";
import { ChainKeys } from "@sodax/sdk";
import { getDepositTokens } from "@/lib/chains";
import { DEFAULT_SELL_USDC_BASE, defaultSellDestination } from "./sell-destination";

describe("defaultSellDestination", () => {
  it("resolves the SDK's own USDC on Base", () => {
    const found = defaultSellDestination();
    expect(found?.chainKey).toBe(ChainKeys.BASE_MAINNET);
    expect(found?.token.address.toLowerCase()).toBe(DEFAULT_SELL_USDC_BASE.toLowerCase());
    expect(found?.token.symbol).toBe("USDC");
    expect(found?.token.decimals).toBe(6);
    expect(getDepositTokens(ChainKeys.BASE_MAINNET)).toContain(found?.token);
  });

  it("matches the address whatever its case", () => {
    const base = getDepositTokens(ChainKeys.BASE_MAINNET).find((t) => t.symbol === "USDC")!;
    const lower = { ...base, address: base.address.toLowerCase() } as typeof base;
    expect(defaultSellDestination([lower])?.token).toBe(lower);
  });

  it("is null when the token list does not carry it", () => {
    const others = getDepositTokens(ChainKeys.BASE_MAINNET).filter((t) => t.symbol !== "USDC");
    expect(defaultSellDestination(others)).toBeNull();
    expect(defaultSellDestination([])).toBeNull();
  });
});
