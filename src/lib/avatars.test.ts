import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AVATARS,
  avatarLockedSrc,
  avatarSrc,
  avatarUnlockLevel,
  canUseAvatar,
  isAvatarId,
  resolveAvatarId,
} from "./avatars";

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
    expect(avatarSrc("bollard")).toBe("/avatars/seal.svg");
    expect(avatarSrc("dog")).toBeUndefined();
    expect(avatarSrc(null)).toBeUndefined();
  });

  it("resolves a retired tea-era id to its harbour equivalent", () => {
    expect(avatarSrc("cup")).toBe("/avatars/seal.svg");
  });
});

describe("resolveAvatarId", () => {
  it("maps a retired id onto its harbour equivalent", () => {
    expect(resolveAvatarId("leaf")).toBe("ring");
  });
});

describe("AVATARS", () => {
  it("every entry's src and locked silhouette exist on disk", () => {
    for (const avatar of AVATARS) {
      for (const src of [avatar.src, avatarLockedSrc(avatar.id)!]) {
        const filePath = path.join(process.cwd(), "public", src);
        expect(existsSync(filePath), `${src} is missing`).toBe(true);
      }
    }
  });

  it("keeps every id that ever shipped, eleven faces in all", () => {
    expect(AVATARS.map((a) => a.id)).toEqual([
      "bollard", "cleat", "ring", "lantern", "buoy", "rope",
      "tidemark", "compass", "beacon", "bell", "capstan",
    ]);
  });

  it("points a locked face at its silhouette", () => {
    expect(avatarLockedSrc("beacon")).toBe("/avatars/locked/blue-crab.svg");
    expect(avatarLockedSrc("dog")).toBeUndefined();
  });
});

describe("rank-gated faces", () => {
  it("keeps the first eight open from the first rung", () => {
    const open = AVATARS.filter((avatar) => avatarUnlockLevel(avatar.id) === 1);
    expect(open).toHaveLength(8);
    for (const avatar of open) expect(canUseAvatar(avatar.id, 1)).toBe(true);
  });

  it("opens the Blue Crab at 7, the Porpoise at 8 and the Blue Lobster at 10", () => {
    expect(avatarUnlockLevel("beacon")).toBe(7);
    expect(avatarUnlockLevel("bell")).toBe(8);
    expect(avatarUnlockLevel("capstan")).toBe(10);
  });

  it("locks a face below its rung and opens it on the rung", () => {
    expect(canUseAvatar("beacon", 6)).toBe(false);
    expect(canUseAvatar("beacon", 7)).toBe(true);
    expect(canUseAvatar("bell", 7)).toBe(false);
    expect(canUseAvatar("capstan", 9)).toBe(false);
    expect(canUseAvatar("capstan", 10)).toBe(true);
  });
});

describe("the welcome page's count of faces", () => {
  it("still has eight open and three earned, as COPY.welcomePage.features.ranks.faces says", () => {
    const earned = AVATARS.filter((a) => "unlockLevel" in a).length;
    expect(AVATARS.length - earned).toBe(8);
    expect(earned).toBe(3);
  });
});
