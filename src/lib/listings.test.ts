import { describe, expect, it } from "vitest";
import { ChainKeys, leverageYieldVaults } from "@sodax/sdk";
import { getAddress, isAddress } from "viem";
import {
  CASH_LISTING,
  STOCK_LISTINGS,
  TOKEN_LISTINGS,
  findListing,
  isTokenListingAddress,
  listListings,
  toXToken,
  vaultListing,
} from "./listings";

/**
 * The registry is a hand-pinned snapshot of the backend's Sonic token list,
 * verified on chain on 2026-09-16. `pnpm listings:verify` re-checks it
 * against the network; these tests pin the shape and the invariants the app
 * leans on, offline.
 */
describe("token listings", () => {
  it("carries the thirteen Robinhood tokens the solver trades on Sonic", () => {
    expect(TOKEN_LISTINGS.map((listing) => listing.symbol)).toEqual([
      "SPCX",
      "NVDA",
      "GME",
      "MSTR",
      "AAPL",
      "TSLA",
      "MU",
      "SNDK",
      "SPY",
      "QQQ",
      "SGOV",
      "USO",
      "SLV",
    ]);
  });

  it("pins the addresses verified on chain", () => {
    const byAddress = Object.fromEntries(
      TOKEN_LISTINGS.map((listing) => [listing.symbol, listing.address]),
    );
    expect(byAddress).toEqual({
      SPCX: "0xB585e2EEa070eB4E4D877A707aEC3B718edb2373",
      NVDA: "0x2D5D2250EE426cA318efBd03ddf926B23c96f74B",
      GME: "0x996e5591e4692e2B7d8fB6926DeA4EE1950Ef394",
      MSTR: "0xE0E2aF45EBf5700a90E63c41B0ecE042A240Fab1",
      AAPL: "0x4712D2D49Ba3be41DA334FCB3616FDdc0d745185",
      TSLA: "0x8B7F46967Ed9367A70b2e046D5e26a03625d53b1",
      MU: "0x108147b16186B895344F5752468190B9EE0e3A22",
      SNDK: "0x568F29855B7B46EdA38ed95771FAeC498c507EF7",
      SPY: "0x1816E408f0448D0CaD3e0D490bd2590d921Bb0c8",
      QQQ: "0x454ab3DeFd9df0749d450b145D4516e317E3e500",
      SGOV: "0xf6938087cf794B08739b926B41FF8F1E90816E74",
      USO: "0x8DaBbADcecfc1a0B91fc68c72301090bc220D2bc",
      SLV: "0x690B92c27ac80015E57DB8cc02A81255814f49A2",
    });
  });

  it("writes every address in valid EIP-55 casing", () => {
    // viem refuses a bad checksum while ENCODING a multicall, which would
    // zero every balance read in the batch (see lib/chains for the SDK's own
    // Polygon casing bug). Ours must never carry that risk.
    for (const listing of TOKEN_LISTINGS) {
      expect(isAddress(listing.address, { strict: true })).toBe(true);
      expect(getAddress(listing.address)).toBe(listing.address);
    }
  });

  it("never lists a symbol or an address twice", () => {
    const symbols = TOKEN_LISTINGS.map((listing) => listing.symbol);
    expect(new Set(symbols).size).toBe(symbols.length);
    const addresses = TOKEN_LISTINGS.map((listing) =>
      listing.address.toLowerCase(),
    );
    expect(new Set(addresses).size).toBe(addresses.length);
  });

  it("keeps every token at 18 decimals under the Robinhood wrapper", () => {
    for (const listing of TOKEN_LISTINGS) {
      expect(listing.decimals).toBe(18);
      expect(listing.wrapper).toBe("robinhood");
      expect(listing.issuerName.endsWith("• Robinhood Token")).toBe(true);
    }
  });

  it("names every listing in plain words, never by ticker", () => {
    for (const listing of TOKEN_LISTINGS) {
      expect(listing.name).not.toBe(listing.symbol);
      expect(listing.name.length).toBeGreaterThan(2);
    }
  });

  it("has SGOV as the one cash listing and twelve stocks", () => {
    expect(CASH_LISTING.symbol).toBe("SGOV");
    expect(CASH_LISTING.kind).toBe("cash");
    expect(CASH_LISTING.category).toBe("treasury");
    expect(STOCK_LISTINGS).toHaveLength(12);
    expect(STOCK_LISTINGS.every((listing) => listing.kind === "stock")).toBe(
      true,
    );
    expect(STOCK_LISTINGS.some((listing) => listing.symbol === "SGOV")).toBe(
      false,
    );
  });

  it("marks SpaceX as listed equity, since its Nasdaq listing on 2026-07-01", () => {
    const spcx = TOKEN_LISTINGS.find((listing) => listing.symbol === "SPCX");
    expect(spcx?.category).toBe("equity");
  });

  it("never shares an address with a vault the SDK knows", () => {
    const vaultAddresses = new Set(
      leverageYieldVaults.map((vault) => vault.vault.toLowerCase()),
    );
    for (const listing of TOKEN_LISTINGS) {
      expect(vaultAddresses.has(listing.address.toLowerCase())).toBe(false);
    }
  });
});

describe("toXToken", () => {
  it("shapes a listing as a Sonic-native token whose hub asset is itself", () => {
    const nvda = TOKEN_LISTINGS.find((listing) => listing.symbol === "NVDA")!;
    expect(toXToken(nvda)).toEqual({
      symbol: "NVDA",
      name: "NVIDIA • Robinhood Token",
      decimals: 18,
      address: nvda.address,
      chainKey: ChainKeys.SONIC_MAINNET,
      hubAsset: nvda.address,
      vault: nvda.address,
    });
  });
});

describe("listListings", () => {
  const listings = listListings(leverageYieldVaults);

  it("puts the cups first, then the token listings, and loses nothing", () => {
    expect(listings).toHaveLength(
      leverageYieldVaults.length + TOKEN_LISTINGS.length,
    );
    expect(listings.slice(0, leverageYieldVaults.length).map((l) => l.kind)).toEqual(
      leverageYieldVaults.map(() => "vault"),
    );
    expect(listings.slice(leverageYieldVaults.length)).toEqual(TOKEN_LISTINGS);
  });

  it("wraps a vault with its share token as the address", () => {
    const first = leverageYieldVaults[0];
    expect(vaultListing(first)).toMatchObject({
      kind: "vault",
      symbol: first.name,
      address: first.vault,
      decimals: 18,
      vault: first,
    });
  });

  it("finds a listing by address regardless of casing", () => {
    const nvda = TOKEN_LISTINGS.find((listing) => listing.symbol === "NVDA")!;
    expect(findListing(listings, nvda.address.toLowerCase())?.symbol).toBe(
      "NVDA",
    );
    expect(findListing(listings, nvda.address.toUpperCase().replace("0X", "0x"))?.symbol).toBe(
      "NVDA",
    );
    expect(findListing(listings, leverageYieldVaults[0].vault)?.kind).toBe(
      "vault",
    );
    expect(findListing(listings, undefined)).toBeUndefined();
    expect(
      findListing(listings, "0x0000000000000000000000000000000000000000"),
    ).toBeUndefined();
  });
});

describe("isTokenListingAddress", () => {
  it("recognises the pinned tokens in any casing and nothing else", () => {
    for (const listing of TOKEN_LISTINGS) {
      expect(isTokenListingAddress(listing.address)).toBe(true);
      expect(isTokenListingAddress(listing.address.toLowerCase())).toBe(true);
    }
    expect(isTokenListingAddress(leverageYieldVaults[0].vault)).toBe(false);
    expect(
      isTokenListingAddress("0x29219dd400f2Bf60E5a23d13Be72B486D4038894"),
    ).toBe(false);
  });
});
