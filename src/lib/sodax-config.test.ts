import { describe, expect, it } from "vitest";
import { ChainKeys, Sodax, sonicSupportedTokens } from "@sodax/sdk";
import { getDepositTokens } from "./chains";
import { sodaxConfig } from "./sodax-config";

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
