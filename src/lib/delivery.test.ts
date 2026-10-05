import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { PSEUDO_COUNTRY_CODES, ROBINHOOD_RESTRICTED_COUNTRIES, deliveryFor, hubDelivery, knownCountry } from "./delivery";

const WALLET = "0xbe59d5bf40ac4a349bd748e0d7c19ef27ad3ca23";
const CHECKSUMMED = getAddress(WALLET);

describe("deliveryFor", () => {
  it("delivers a switched account's buy to its own wallet on Robinhood Chain, checksummed", () => {
    expect(deliveryFor({ switched: true, evmAddress: WALLET, country: "NL" })).toEqual({
      chainKey: "robinhood",
      address: CHECKSUMMED,
      reason: "switched_on",
    });
    expect(deliveryFor({ switched: true, evmAddress: ` ${CHECKSUMMED} `, country: "nl" })).toEqual({
      chainKey: "robinhood",
      address: CHECKSUMMED,
      reason: "switched_on",
    });
  });

  it("keeps an account that is not switched on the hub, whatever else is true", () => {
    expect(deliveryFor({ switched: false, evmAddress: WALLET, country: "NL" })).toEqual(hubDelivery("not_listed"));
  });

  it("keeps an account with no EVM wallet on the hub", () => {
    expect(deliveryFor({ switched: true, evmAddress: null, country: "NL" })).toEqual(hubDelivery("no_evm_wallet"));
    expect(deliveryFor({ switched: true, evmAddress: "", country: "NL" })).toEqual(hubDelivery("no_evm_wallet"));
    // A Solana address is a wallet, but not one Robinhood Chain can pay.
    expect(deliveryFor({ switched: true, evmAddress: "7EYnhQoR9YM3N7UoaKRoA44Uy8JeaZV3qyouov87awMs", country: "NL" })).toEqual(
      hubDelivery("no_evm_wallet"),
    );
  });

  it("keeps the United Kingdom, Canada, Switzerland and the Crown Dependencies on the hub even when switched", () => {
    expect([...ROBINHOOD_RESTRICTED_COUNTRIES].sort()).toEqual(["CA", "CH", "GB", "GG", "IM", "JE"]);
    for (const country of ["GB", "CA", "CH", "JE", "GG", "IM", "gb", "je"]) {
      expect(deliveryFor({ switched: true, evmAddress: WALLET, country }), country).toEqual(hubDelivery("restricted_country"));
    }
  });

  it("keeps an unknown country on the hub rather than guessing", () => {
    for (const country of [null, undefined, "", "Netherlands", "N1"]) {
      expect(deliveryFor({ switched: true, evmAddress: WALLET, country }), String(country)).toEqual(hubDelivery("unknown_country"));
    }
  });

  it("counts a provider's pseudo country code as unknown, not as somewhere unrestricted", () => {
    for (const country of ["XX", "ZZ", "T1", "EU", "AP", "A1", "A2", "O1", "eu"]) {
      expect(knownCountry(country), country).toBeNull();
      expect(deliveryFor({ switched: true, evmAddress: WALLET, country }), country).toEqual(hubDelivery("unknown_country"));
    }
    expect(PSEUDO_COUNTRY_CODES.size).toBe(8);
    expect(knownCountry(" nl ")).toBe("NL");
  });
});
