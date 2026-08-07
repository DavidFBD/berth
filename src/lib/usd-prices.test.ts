import { describe, expect, it } from "vitest";

import { resolveTokenUsdPrice } from "@/lib/usd-prices";

const token = {
  vault: "0xVaultAddress",
  hubAsset: "0xHubAssetAddress",
  symbol: "WBTC",
};

const byHub = (entries: Record<string, number>) =>
  new Map(Object.entries(entries));

describe("resolveTokenUsdPrice", () => {
  it("prefers the oracle price keyed by the soda vault", () => {
    const price = resolveTokenUsdPrice(
      token,
      byHub({ "0xvaultaddress": 100, "0xhubassetaddress": 90 }),
      new Map([["wbtc", 80]]),
    );
    expect(price).toBe(100);
  });

  it("falls back to the hub asset when the vault has no reserve", () => {
    const price = resolveTokenUsdPrice(
      token,
      byHub({ "0xhubassetaddress": 90 }),
      new Map([["wbtc", 80]]),
    );
    expect(price).toBe(90);
  });

  it("falls back to the market symbol price when the oracle knows neither", () => {
    const price = resolveTokenUsdPrice(token, new Map(), new Map([["wbtc", 80]]));
    expect(price).toBe(80);
  });

  it("stays undefined when no source knows the token", () => {
    expect(resolveTokenUsdPrice(token, new Map(), new Map())).toBeUndefined();
  });

  it("matches addresses and symbols case-insensitively", () => {
    const price = resolveTokenUsdPrice(
      { vault: "0xVAULT", hubAsset: "0xHUB", symbol: "Bonk" },
      new Map(),
      new Map([["bonk", 0.00002]]),
    );
    expect(price).toBe(0.00002);
  });
});
