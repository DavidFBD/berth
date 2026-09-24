import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { levelUpRank, rankForXp, rankGlyphSrc, RANKS, REWARD_REASONS, XP_ACTIONS } from "./xp";

describe("levelUpRank", () => {
  it("returns the rank arrived at when a boundary is crossed", () => {
    const reached = levelUpRank(90, 110);
    expect(reached?.level).toBe(2);
    expect(reached?.name).toBe("Slip");
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

  it("derives the crossing from a response's rewards delta (the announcer's shape)", () => {
    // newXp 250, one +250 reward: before = 0, after = 250 → level 3 card.
    const total = 250;
    expect(levelUpRank(250 - total, 250)?.level).toBe(3);
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

describe("rankGlyphSrc", () => {
  it("names one glyph per rung, zero padded", () => {
    expect(rankGlyphSrc(1)).toBe("/ranks/rank-01.svg");
    expect(rankGlyphSrc(10)).toBe("/ranks/rank-10.svg");
  });

  it("clamps levels off the ladder to its ends", () => {
    expect(rankGlyphSrc(0)).toBe("/ranks/rank-01.svg");
    expect(rankGlyphSrc(42)).toBe("/ranks/rank-10.svg");
  });

  it("every rung's glyph exists on disk", () => {
    for (const rank of RANKS) {
      const src = rankGlyphSrc(rank.level);
      expect(existsSync(path.join(process.cwd(), "public", src)), `${src} is missing`).toBe(true);
    }
  });
});

describe("held_30_days", () => {
  it("pays 150 XP, repeatably, with a reason for the ledger", () => {
    expect(XP_ACTIONS.held_30_days).toEqual({ amount: 150, once: false });
    expect(REWARD_REASONS.held_30_days).toBe("for holding thirty days");
  });
});
