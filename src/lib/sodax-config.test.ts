import { describe, expect, it } from "vitest";
import { ChainKeys, Sodax, sonicSupportedTokens } from "@sodax/sdk";
import { DEPOSIT_SOURCE_CHAINS, getDepositTokens } from "./chains";
import { TOKEN_LISTINGS } from "./listings";
import { getPinnedRpcUrls, sodaxConfig } from "./sodax-config";

/**
 * The vault shelf is only as long as the SDK's static registry, which the app
 * extends by hand while lsodaSUSDS waits for an SDK release. These pin the
 * extension from both sides: the fourth cup is really there, and it stays
 * exactly one cup when the SDK eventually carries it too.
 */
describe("sodaxConfig vault registry", () => {
  const vaults = new Sodax(sodaxConfig).leverageYield.listVaults();

  it("serves four vaults through the SDK, not three", () => {
    expect(vaults.map((vault) => vault.name)).toEqual([
      "lsodaWEETH",
      "lsodaWSTETH",
      "lsodaJITOSOL",
      "lsodaSUSDS",
    ]);
  });

  it("never lists a vault twice, however the SDK grows", () => {
    const names = vaults.map((vault) => vault.name);
    expect(new Set(names).size).toBe(names.length);
    const addresses = vaults.map((vault) => vault.vault.toLowerCase());
    expect(new Set(addresses).size).toBe(addresses.length);
  });

  it("carries the hub addresses the API serves for lsodaSUSDS", () => {
    const susds = vaults.find((vault) => vault.name === "lsodaSUSDS");
    expect(susds).toMatchObject({
      vault: "0x758532F160D9D338bf662A4a59BA31a5B918A7cb",
      asset: "0x243b0c26c8b38793908d7C64e8510f21B19B4613",
      borrowToken: "0xb780e09576C2667ba9F5B80FbAb2e6b8A0a21e37",
    });
  });
});

/**
 * A vault on the shelf is not yet a token the SDK will trade. Quotes and
 * deposit builds both start with `isValidOriginalAssetAddress(sonic, vault)`,
 * and the plain 2.0.0 config answers false for lsodaSUSDS, which is the
 * fourth cup never quoting (2026-09-16). These pin the registration.
 */
describe("sodaxConfig fourth-cup token registration", () => {
  const sodax = new Sodax(sodaxConfig);
  const susds = "0x758532F160D9D338bf662A4a59BA31a5B918A7cb";

  it("lets the ConfigService validate lsodaSUSDS as a Sonic token", () => {
    expect(
      sodax.config.isValidOriginalAssetAddress(ChainKeys.SONIC_MAINNET, susds),
    ).toBe(true);
    expect(
      sodax.config.getSpokeTokenFromOriginalAssetAddress(
        ChainKeys.SONIC_MAINNET,
        susds,
      )?.hubAsset,
    ).toBe(susds);
  });

  it("keeps every Sonic token the SDK already knows", () => {
    for (const token of Object.values(sonicSupportedTokens)) {
      expect(
        sodax.config.isValidOriginalAssetAddress(
          ChainKeys.SONIC_MAINNET,
          token.address,
        ),
      ).toBe(true);
    }
  });

  it("never offers lsodaSUSDS as something to pour in", () => {
    expect(
      getDepositTokens(ChainKeys.SONIC_MAINNET).some(
        (token) => token.symbol === "lsodaSUSDS",
      ),
    ).toBe(false);
  });
});

/**
 * The listings are in the same position the fourth cup was: the backend
 * trades them, the chain holds them, and the installed SDK has never heard
 * of them. Same registration, same failure if it slips: a quote for NVDA
 * would throw `unsupported token_dst` before the request left. These pin
 * every listing through the instance's ConfigService, both the validation
 * and the address it resolves to, so an SDK release that learns a ticker
 * under a different wrapper's contract fails here instead of in a pour.
 */
describe("sodaxConfig listing registration", () => {
  const sodax = new Sodax(sodaxConfig);

  it("lets the ConfigService validate every listing as a Sonic token", () => {
    for (const listing of TOKEN_LISTINGS) {
      expect(
        sodax.config.isValidOriginalAssetAddress(
          ChainKeys.SONIC_MAINNET,
          listing.address,
        ),
        `${listing.symbol} should validate on Sonic`,
      ).toBe(true);
    }
  });

  it("resolves each listing to its own address, as a Sonic-native hub asset", () => {
    for (const listing of TOKEN_LISTINGS) {
      const token = sodax.config.getSpokeTokenFromOriginalAssetAddress(
        ChainKeys.SONIC_MAINNET,
        listing.address,
      );
      expect(token, `${listing.symbol} should resolve`).toBeDefined();
      expect(token?.symbol).toBe(listing.symbol);
      expect(token?.decimals).toBe(18);
      expect(token?.hubAsset.toLowerCase()).toBe(listing.address.toLowerCase());
      expect(token?.chainKey).toBe(ChainKeys.SONIC_MAINNET);
    }
  });

  it("never offers a listing as something to pour in, on any chain", () => {
    const listed = new Set(
      TOKEN_LISTINGS.map((listing) => listing.address.toLowerCase()),
    );
    for (const chainKey of DEPOSIT_SOURCE_CHAINS) {
      for (const token of getDepositTokens(chainKey)) {
        expect(listed.has(token.address.toLowerCase())).toBe(false);
      }
    }
  });

  it("still knows the vault share tokens after the listings joined", () => {
    for (const vault of sodax.leverageYield.listVaults()) {
      expect(
        sodax.config.isValidOriginalAssetAddress(
          ChainKeys.SONIC_MAINNET,
          vault.vault,
        ),
      ).toBe(true);
    }
  });
});

describe("Polygon RPC failover", () => {
  it("lists dRPC first, then publicnode, for the embedded wallet's own clients", () => {
    const urls = ["https://polygon.drpc.org", "https://polygon-bor-rpc.publicnode.com"];
    expect(getPinnedRpcUrls(ChainKeys.POLYGON_MAINNET)).toEqual(urls);
  });

  it("gives the core SDK's spoke the pin alone: @sodax/sdk 2.0.0 ignores a spoke's rpcUrls, so a list there would promise a failover that does not happen", () => {
    expect(sodaxConfig.chains?.[ChainKeys.POLYGON_MAINNET]).toMatchObject({ rpcUrl: "https://polygon.drpc.org" });
    expect(sodaxConfig.chains?.[ChainKeys.POLYGON_MAINNET]).not.toHaveProperty("rpcUrls");
  });

  it("leaves a chain without failovers on its single pin", () => {
    expect(getPinnedRpcUrls(ChainKeys.BASE_MAINNET)).toEqual(["https://mainnet.base.org"]);
    expect(sodaxConfig.chains?.[ChainKeys.BASE_MAINNET]).not.toHaveProperty("rpcUrls");
  });
});

describe("Robinhood Chain RPC failover", () => {
  it("lists publicnode first, then dRPC, same two-provider shape as Polygon", () => {
    const urls = ["https://robinhood-rpc.publicnode.com", "https://robinhood.drpc.org"];
    expect(getPinnedRpcUrls(ChainKeys.ROBINHOOD_MAINNET)).toEqual(urls);
  });

  it("gives the core SDK's spoke the pin alone, same reason as Polygon above", () => {
    expect(sodaxConfig.chains?.[ChainKeys.ROBINHOOD_MAINNET]).toMatchObject({
      rpcUrl: "https://robinhood-rpc.publicnode.com",
    });
    expect(sodaxConfig.chains?.[ChainKeys.ROBINHOOD_MAINNET]).not.toHaveProperty("rpcUrls");
  });
});
