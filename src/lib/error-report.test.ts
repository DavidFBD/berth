import { describe, expect, it } from "vitest";
import { fingerprintOf, type ErrorReportContext } from "./error-report";

/**
 * The fingerprint groups failures by cause so one bug is one issue. Issues
 * #16 through #20 are what happens when it doesn't: a single Solana RPC
 * outage, filed five times, because the node echoed a fresh request id into
 * every message and the id survived normalisation. These tests pin the
 * volatile shapes that must never reach the hash.
 */
const context = (rawMessage: string): ErrorReportContext => ({
  action: "deposit",
  step: "signing",
  errorCode: "INTENT_CREATION_FAILED",
  srcChainKey: "solana",
  friendlyMessage: "The order did not go through. Try again.",
  rawMessage,
});

describe("fingerprintOf", () => {
  it("groups one RPC outage into one issue, whatever request id it quotes", () => {
    // Verbatim from #16 and #17, which differ only in the echoed id.
    const sixteen = context(
      'SodaxError: failed to get info about account 2bLSKgpPTS4r5YSzCYFUfdzDn7pG4nVxRiMKPWFJjpHC: Error: 403 : {"jsonrpc":"2.0","error":{"code": 403, "message":"Access forbidden"}, "id": "38ba2844-c29b-4179-8bcf-f9c8378c0a4a" }',
    );
    const seventeen = context(
      'SodaxError: failed to get info about account 2bLSKgpPTS4r5YSzCYFUfdzDn7pG4nVxRiMKPWFJjpHC: Error: 403 : {"jsonrpc":"2.0","error":{"code": 403, "message":"Access forbidden"}, "id": "5f876c5f-f0b8-4cf5-aecf-3d5c29d23215" }',
    );
    expect(fingerprintOf(sixteen)).toBe(fingerprintOf(seventeen));
  });

  it("groups the same failure from two different accounts", () => {
    const mine = context("failed to get info about account 2bLSKgpPTS4r5YSzCYFUfdzDn7pG4nVxRiMKPWFJjpHC: 403");
    const yours = context("failed to get info about account 9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin: 403");
    expect(fingerprintOf(mine)).toBe(fingerprintOf(yours));
  });

  it("groups an unpayable fee whatever the balance was", () => {
    const poorer = context("have 743300593668700 want 975917986270590");
    const richer = context("have 12 want 9759179862705900");
    expect(fingerprintOf(poorer)).toBe(fingerprintOf(richer));
  });

  it("still tells genuinely different causes apart", () => {
    const forbidden = context("Access forbidden");
    const unpayable = context("exceeds the balance of the account");
    expect(fingerprintOf(forbidden)).not.toBe(fingerprintOf(unpayable));
  });

  it("keeps one cause per chain, since a chain is a different fix", () => {
    const solana = context("Access forbidden");
    const base = { ...context("Access forbidden"), srcChainKey: "0x2105.base" };
    expect(fingerprintOf(solana)).not.toBe(fingerprintOf(base));
  });
});
