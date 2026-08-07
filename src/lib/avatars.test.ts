import { describe, expect, it } from "vitest";
import { AVATARS, avatarSrc, isAvatarId } from "./avatars";

describe("isAvatarId", () => {
  it("accepts every face on the shelf", () => {
    for (const avatar of AVATARS) expect(isAvatarId(avatar.id)).toBe(true);
  });

  it("rejects ids that never shipped", () => {
    expect(isAvatarId("dog")).toBe(false);
    expect(isAvatarId("")).toBe(false);
  });
});

describe("avatarSrc", () => {
  it("resolves a shipped id and shrugs at anything else", () => {
    expect(avatarSrc("cup")).toBe("/avatars/cup.svg");
    expect(avatarSrc("dog")).toBeUndefined();
    expect(avatarSrc(null)).toBeUndefined();
  });
});
