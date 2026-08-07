import { describe, expect, it } from "vitest";
import { levelUpRank, rankForXp, RANKS } from "./xp";

describe("levelUpRank", () => {
  it("returns the rank arrived at when a boundary is crossed", () => {
    const reached = levelUpRank(90, 110);
    expect(reached?.level).toBe(2);
    expect(reached?.name).toBe("First Steep");
  });

  it("counts landing exactly on a boundary as arrival", () => {
    expect(levelUpRank(99, 100)?.level).toBe(2);
  });

  it("reports the final rank of a multi-level jump", () => {
    expect(levelUpRank(0, 260)?.level).toBe(3);
  });

  it("stays quiet within a level", () => {
    expect(levelUpRank(10, 90)).toBeNull();
    expect(levelUpRank(100, 100)).toBeNull();
  });

  it("never claims a level-up when either total is unknown", () => {
    expect(levelUpRank(undefined, 110)).toBeNull();
    expect(levelUpRank(90, undefined)).toBeNull();
    expect(levelUpRank(undefined, undefined)).toBeNull();
  });

  it("stays quiet when XP moves down a rung", () => {
    expect(levelUpRank(110, 90)).toBeNull();
  });

  it("fires on every rung of the ladder", () => {
    for (const rank of RANKS.slice(1)) {
      expect(levelUpRank(rank.xp - 1, rank.xp)?.level).toBe(rank.level);
    }
  });
});

describe("rankForXp", () => {
  it("caps progress at the top of the ladder", () => {
    const top = rankForXp(999_999);
    expect(top.level).toBe(10);
    expect(top.progress).toBe(1);
    expect(top.nextName).toBeNull();
  });
});
