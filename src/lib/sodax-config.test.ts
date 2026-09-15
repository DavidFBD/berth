import { describe, expect, it } from "vitest";
import { Sodax } from "@sodax/sdk";
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
