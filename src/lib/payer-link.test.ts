import { describe, expect, it } from "vitest";
import { payerLink } from "./payer-link";
import { COPY } from "./copy";

const SOL = "2vCraXuVuBnHY5F8tPYEKG6s6Qb9aUjk3cpt4VKWKvvW";
const BTC = "bc1qxjjcjwmjapj25nupfelq0l94nlftpymfwfac84";

describe("payerLink", () => {
  it("EVM is the drawer's own signer rule", () => {
    expect(payerLink({ chainType: "EVM", address: "0xabc", linked: [] })).toEqual({ state: "evm" });
  });

  it("a Solana or Bitcoin payer not on the account is asked to be added first", () => {
    expect(payerLink({ chainType: "SOLANA", address: SOL, linked: [] })).toEqual({ state: "unlinked", family: "solana" });
    expect(payerLink({ chainType: "BITCOIN", address: BTC, linked: [{ family: "evm", address: "0xabc" }] })).toEqual({ state: "unlinked", family: "bitcoin" });
  });

  it("one on the account is linked, Bitcoin in either case", () => {
    expect(payerLink({ chainType: "SOLANA", address: SOL, linked: [{ family: "solana", address: SOL }] })).toEqual({ state: "linked" });
    expect(payerLink({ chainType: "BITCOIN", address: BTC.toUpperCase(), linked: [{ family: "bitcoin", address: BTC }] })).toEqual({ state: "linked" });
  });

  it("never blocks while the list is unknown", () => {
    expect(payerLink({ chainType: "SOLANA", address: SOL, linked: undefined })).toEqual({ state: "unknown" });
  });

  it("Sui, Stellar, NEAR, Injective, ICON and Stacks cannot be linked", () => {
    for (const chainType of ["SUI", "STELLAR", "NEAR", "INJECTIVE", "ICON", "STACKS"]) {
      expect(payerLink({ chainType, address: "x", linked: [] })).toEqual({ state: "unlinkable" });
    }
  });

  it("says so plainly, without a dash as punctuation", () => {
    expect(COPY.buyNoXpNetwork).toBe("Buys paid from this network are recorded but earn no XP.");
    expect(COPY.buyLinkForXp).not.toMatch(/ [-–—] /);
  });
});
