import { describe, expect, it } from "vitest";
import { headerAccountState } from "@/lib/header-account";

const WALLET = "0xbe59d5bf40ac4a349bd748e0d7c19ef27ad3ca23";
const base = { hasProfile: false, wallet: WALLET, pending: null, hasSession: false, fetching: false };

describe("headerAccountState", () => {
  it("shows the account once the profile answers, whatever else is true", () => {
    expect(headerAccountState({ ...base, hasProfile: true })).toBe("account");
    expect(headerAccountState({ ...base, hasProfile: true, hasSession: true, fetching: true })).toBe("account");
  });

  it("offers Sign in to a connected wallet with no session, never the address alone", () => {
    // The 2026-10-11 case: signed out, the extension stayed connected, the
    // load's own signature request was dismissed. The pill used to stand alone.
    expect(headerAccountState(base)).toBe("sign-in");
  });

  it("says the wallet is being asked while the signature is open", () => {
    expect(headerAccountState({ ...base, fetching: true })).toBe("signing");
  });

  it("stays quiet while a pocketed session loads, or fails for a reason a signature would not fix", () => {
    expect(headerAccountState({ ...base, hasSession: true, fetching: true })).toBe("none");
    expect(headerAccountState({ ...base, hasSession: true })).toBe("none");
  });

  it("leaves a waiting wallet to the home's own signed in or add line", () => {
    expect(headerAccountState({ ...base, wallet: null, pending: WALLET })).toBe("none");
    expect(headerAccountState({ ...base, pending: WALLET })).toBe("none");
  });

  it("shows nothing without a wallet", () => {
    expect(headerAccountState({ ...base, wallet: null })).toBe("none");
  });
});
