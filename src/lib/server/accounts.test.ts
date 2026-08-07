import { describe, expect, it } from "vitest";
import { normalizeWallet, toProfile, type UserRow } from "./accounts";

describe("normalizeWallet", () => {
  const evm = "0xAbCd1234aBcD1234AbCd1234aBcD1234AbCd1234";

  it("lowercases and trims a plausible address", () => {
    expect(normalizeWallet(`  ${evm} `)).toBe(evm.toLowerCase());
  });

  it("accepts non-EVM shapes within the sane charset", () => {
    // Solana-style base58 and namespaced ids both pass the same gate.
    expect(normalizeWallet("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin")).toBe(
      "9xqewvg816bux9epjhmat23yvvm2zwbrrpzb9pusvfin",
    );
    expect(normalizeWallet("cosmos:hub-4.addr_0-EXAMPLE")).toBe(
      "cosmos:hub-4.addr_0-example",
    );
  });

  it("rejects non-strings", () => {
    expect(normalizeWallet(undefined)).toBeNull();
    expect(normalizeWallet(null)).toBeNull();
    expect(normalizeWallet(42)).toBeNull();
    expect(normalizeWallet({ address: evm })).toBeNull();
  });

  it("rejects strings outside the sane length band", () => {
    expect(normalizeWallet("0x1234567890abcdef")).toBeNull(); // 18 < 20
    expect(normalizeWallet("a".repeat(91))).toBeNull();
    expect(normalizeWallet("a".repeat(20))).not.toBeNull();
    expect(normalizeWallet("a".repeat(90))).not.toBeNull();
  });

  it("rejects characters outside the charset", () => {
    expect(normalizeWallet("0x1234 5678901234567890")).toBeNull();
    expect(normalizeWallet("0x12345678901234567890!")).toBeNull();
  });
});

describe("toProfile", () => {
  const stale: UserRow = {
    id: "u1",
    privy_did: "did:privy:abc",
    wallet_address: "0xwallet",
    email: null,
    avatar_id: null,
    xp: 25,
    referral_code: null,
    referred_by: null,
  };

  it("patching the held row with a fresh total reflects the write without a re-read", () => {
    expect(toProfile({ ...stale, xp: 135 })).toEqual({
      xp: 135,
      avatarId: null,
      hasEmail: false,
      referralCode: null,
    });
  });

  it("carries route writes like a just-set avatar and email", () => {
    expect(
      toProfile({ ...stale, avatar_id: "kettle", email: "d@example.com" }),
    ).toEqual({
      xp: 25,
      avatarId: "kettle",
      hasEmail: true,
      referralCode: null,
    });
  });

  it("keeps the minted invite code hidden below the unlock rank", () => {
    // Level 2 runs 100..249 XP; the code exists but stays the house's secret.
    expect(
      toProfile({ ...stale, xp: 249, referral_code: "steamy42" }).referralCode,
    ).toBeNull();
  });

  it("reveals the invite code from level 3 (250 XP) up", () => {
    expect(
      toProfile({ ...stale, xp: 250, referral_code: "steamy42" }).referralCode,
    ).toBe("steamy42");
  });
});
