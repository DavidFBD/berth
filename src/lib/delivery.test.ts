import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { HUB_DELIVERY, ROBINHOOD_RESTRICTED_COUNTRIES, deliveryFor } from "./delivery";

const WALLET = "0xbe59d5bf40ac4a349bd748e0d7c19ef27ad3ca23";
const CHECKSUMMED = getAddress(WALLET);

describe("deliveryFor", () => {
  it("delivers a switched account's buy to its own wallet on Robinhood Chain, checksummed", () => {
    expect(deliveryFor({ switched: true, evmAddress: WALLET, country: "NL" })).toEqual({
      chainKey: "robinhood",
      address: CHECKSUMMED,
    });
    expect(deliveryFor({ switched: true, evmAddress: ` ${CHECKSUMMED} `, country: "nl" })).toEqual({
      chainKey: "robinhood",
      address: CHECKSUMMED,
    });
  });

  it("keeps an account that is not switched on the hub, whatever else is true", () => {
    expect(deliveryFor({ switched: false, evmAddress: WALLET, country: "NL" })).toEqual(HUB_DELIVERY);
  });

  it("keeps an account with no EVM wallet on the hub", () => {
    expect(deliveryFor({ switched: true, evmAddress: null, country: "NL" })).toEqual(HUB_DELIVERY);
    expect(deliveryFor({ switched: true, evmAddress: "", country: "NL" })).toEqual(HUB_DELIVERY);
    // A Solana address is a wallet, but not one Robinhood Chain can pay.
    expect(deliveryFor({ switched: true, evmAddress: "7EYnhQoR9YM3N7UoaKRoA44Uy8JeaZV3qyouov87awMs", country: "NL" })).toEqual(
      HUB_DELIVERY,
    );
  });

  it("keeps the United Kingdom, Canada and Switzerland on the hub even when switched", () => {
    expect([...ROBINHOOD_RESTRICTED_COUNTRIES].sort()).toEqual(["CA", "CH", "GB"]);
    for (const country of ["GB", "CA", "CH", "gb"]) {
      expect(deliveryFor({ switched: true, evmAddress: WALLET, country }), country).toEqual(HUB_DELIVERY);
    }
  });

  it("keeps an unknown country on the hub rather than guessing", () => {
    expect(deliveryFor({ switched: true, evmAddress: WALLET, country: null })).toEqual(HUB_DELIVERY);
    expect(deliveryFor({ switched: true, evmAddress: WALLET, country: "" })).toEqual(HUB_DELIVERY);
    expect(deliveryFor({ switched: true, evmAddress: WALLET, country: "Netherlands" })).toEqual(HUB_DELIVERY);
  });
});
