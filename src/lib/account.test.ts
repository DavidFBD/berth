import { describe, expect, it } from "vitest";
import { ChainKeys } from "@sodax/sdk";
import { resolveAccount, type AccountSession } from "./account";

const EMBEDDED = "0xE0000000000000000000000000000000000000dd";
const STORE = "0x5000000000000000000000000000000000000005";
const SOLANA_STORE = "So1anaAddre55";

const emailSession: AccountSession = {
  emailSession: true,
  embeddedEvmAddress: EMBEDDED,
};
const externalSession: AccountSession = {
  emailSession: false,
  embeddedEvmAddress: undefined,
};
/** Privy still initializing: authenticated, embedded wallet not live yet. */
const warmingSession: AccountSession = {
  emailSession: false,
  embeddedEvmAddress: undefined,
};

describe("resolveAccount", () => {
  it("email session wins on EVM: the embedded address, mode email", () => {
    const resolved = resolveAccount(ChainKeys.SONIC_MAINNET, emailSession, STORE);
    expect(resolved).toEqual({ address: EMBEDDED, mode: "email" });
  });

  it("the store wins off EVM, even in an email session (bridged Solana)", () => {
    const resolved = resolveAccount(
      ChainKeys.SOLANA_MAINNET,
      emailSession,
      SOLANA_STORE,
    );
    expect(resolved).toEqual({ address: SOLANA_STORE, mode: "external" });
  });

  it("external-only browsers always resolve to the store", () => {
    expect(resolveAccount(ChainKeys.SONIC_MAINNET, externalSession, STORE)).toEqual({
      address: STORE,
      mode: "external",
    });
    expect(
      resolveAccount(ChainKeys.BITCOIN_MAINNET, externalSession, "bc1qsomething"),
    ).toEqual({ address: "bc1qsomething", mode: "external" });
  });

  it("a session whose embedded wallet is not live yet resolves to the store", () => {
    // The address that reads must be the address that signs: an embedded
    // wallet that can't sign yet must not claim the EVM slot.
    expect(resolveAccount(ChainKeys.SONIC_MAINNET, warmingSession, STORE)).toEqual({
      address: STORE,
      mode: "external",
    });
  });

  it("no chain picked: no address, external", () => {
    expect(resolveAccount(null, emailSession, STORE)).toEqual({
      address: undefined,
      mode: "external",
    });
    expect(resolveAccount(undefined, emailSession, STORE)).toEqual({
      address: undefined,
      mode: "external",
    });
  });

  it("no store account off EVM: undefined, not a guess", () => {
    expect(
      resolveAccount(ChainKeys.SOLANA_MAINNET, emailSession, undefined),
    ).toEqual({ address: undefined, mode: "external" });
  });
});
