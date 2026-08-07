import { describe, expect, it } from "vitest";
import { CODE_LENGTH, isInviteCode, normalizeInviteCode } from "./invite-code";

describe("normalizeInviteCode", () => {
  it("lowercases and trims a well-shaped code", () => {
    expect(normalizeInviteCode("  STEAMY42 ")).toBe("steamy42");
  });

  it("rejects lookalike characters the mint never uses", () => {
    // i, l, o, 0, 1 are excluded from the alphabet on purpose.
    expect(normalizeInviteCode("kettl e1")).toBeNull();
    expect(normalizeInviteCode("kettle10")).toBeNull();
    expect(normalizeInviteCode("oilfield")).toBeNull();
  });

  it("rejects wrong lengths and non-strings", () => {
    expect(normalizeInviteCode("short")).toBeNull();
    expect(normalizeInviteCode("waytoolongforacode")).toBeNull();
    expect(normalizeInviteCode(undefined)).toBeNull();
    expect(normalizeInviteCode(42)).toBeNull();
  });
});

describe("isInviteCode", () => {
  it("agrees with the normalizer, case-insensitively", () => {
    expect(isInviteCode("STEAMY42")).toBe(true);
    expect(isInviteCode("steamy42")).toBe(true);
    // The famous escape artist: pocketable under the old client regex,
    // unmintable under the real alphabet.
    expect(isInviteCode("oilfield")).toBe(false);
  });

  it("matches the mint's length exactly", () => {
    expect(isInviteCode("a".repeat(CODE_LENGTH))).toBe(true);
    expect(isInviteCode("a".repeat(CODE_LENGTH - 1))).toBe(false);
    expect(isInviteCode("a".repeat(CODE_LENGTH + 1))).toBe(false);
  });
});
