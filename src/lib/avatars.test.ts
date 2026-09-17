import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AVATARS, avatarSrc, isAvatarId, resolveAvatarId } from "./avatars";

describe("isAvatarId", () => {
  it("accepts every face on the shelf", () => {
    for (const avatar of AVATARS) expect(isAvatarId(avatar.id)).toBe(true);
  });

  it("rejects ids that never shipped, and ids retired before the rebrand", () => {
    expect(isAvatarId("dog")).toBe(false);
    expect(isAvatarId("")).toBe(false);
    expect(isAvatarId("cup")).toBe(false);
  });
});

describe("avatarSrc", () => {
  it("resolves a shipped id and shrugs at anything else", () => {
    expect(avatarSrc("bollard")).toBe("/avatars/bollard.svg");
    expect(avatarSrc("dog")).toBeUndefined();
    expect(avatarSrc(null)).toBeUndefined();
  });

  it("resolves a retired tea-era id to its harbour equivalent", () => {
    expect(avatarSrc("cup")).toBe("/avatars/bollard.svg");
  });
});

describe("resolveAvatarId", () => {
  it("maps a retired id onto its harbour equivalent", () => {
    expect(resolveAvatarId("leaf")).toBe("ring");
  });
});

describe("AVATARS", () => {
  it("every entry's src exists on disk", () => {
    for (const avatar of AVATARS) {
      const filePath = path.join(process.cwd(), "public", avatar.src);
      expect(existsSync(filePath), `${avatar.src} is missing`).toBe(true);
    }
  });
});
