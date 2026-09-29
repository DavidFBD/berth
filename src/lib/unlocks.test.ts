import { describe, expect, it } from "vitest";
import { AVATARS, avatarUnlockLevel } from "./avatars";
import { unlockAt, unlockLevels, unlocksBetween } from "./unlocks";
import { CHAT_UNLOCK_LEVEL, INVITE_UNLOCK_LEVEL, RANKS, XP_ACTIONS, rankForXp } from "./xp";

describe("unlockAt", () => {
  it("opens the invite link at the invite rung", () => {
    expect(INVITE_UNLOCK_LEVEL).toBe(3);
    expect(unlockAt(3)).toEqual({ kind: "invite" });
  });

  it("opens the assistant at the chat rung, the first one above the start", () => {
    expect(CHAT_UNLOCK_LEVEL).toBe(2);
    expect(unlockAt(2)).toEqual({ kind: "chat" });
  });

  it("opens the three rank faces on their rungs", () => {
    expect(unlockAt(7)).toEqual({ kind: "avatar", avatarId: "beacon", face: "Blue Crab" });
    expect(unlockAt(8)).toEqual({ kind: "avatar", avatarId: "bell", face: "Porpoise" });
    expect(unlockAt(10)).toEqual({ kind: "avatar", avatarId: "capstan", face: "Blue Lobster" });
  });

  it("opens nothing on every other rung, or off the ladder", () => {
    for (const level of [1, 4, 5, 6, 9, 0, 11]) {
      expect(unlockAt(level)).toBeNull();
    }
  });

  it("covers every gated face, on the rung the face itself names", () => {
    for (const avatar of AVATARS) {
      const level = avatarUnlockLevel(avatar.id);
      if (level === 1) continue;
      expect(unlockAt(level)).toMatchObject({ kind: "avatar", avatarId: avatar.id });
    }
  });
});

describe("unlockLevels", () => {
  it("lists the opening rungs in ladder order, all on the ladder", () => {
    expect(unlockLevels()).toEqual([2, 3, 7, 8, 10]);
    for (const level of unlockLevels()) {
      expect(RANKS.some((rank) => rank.level === level)).toBe(true);
    }
  });
});

describe("unlocksBetween", () => {
  it("lists every opening passed on a jump, lowest rung first", () => {
    expect(unlocksBetween(6, 8)).toEqual([
      { kind: "avatar", avatarId: "beacon", face: "Blue Crab" },
      { kind: "avatar", avatarId: "bell", face: "Porpoise" },
    ]);
    expect(unlocksBetween(2, 10).map((unlock) => unlockLevelOf(unlock))).toEqual([3, 7, 8, 10]);
    expect(unlocksBetween(1, 3)).toEqual([{ kind: "chat" }, { kind: "invite" }]);
  });

  it("excludes the rung left and includes the rung reached", () => {
    expect(unlocksBetween(7, 8)).toEqual([unlockAt(8)]);
    expect(unlocksBetween(3, 6)).toEqual([]);
    expect(unlocksBetween(8, 8)).toEqual([]);
  });
});

function unlockLevelOf(unlock: ReturnType<typeof unlocksBetween>[number]): number {
  return unlockLevels().find((level) => unlockAt(level) === unlock)!;
}

describe("the chat rung", () => {
  it("is reached by an email sign in, or by a wallet account's first buy", () => {
    const email = XP_ACTIONS.account_created.amount + XP_ACTIONS.email_linked.amount;
    expect(rankForXp(email).level).toBeGreaterThanOrEqual(CHAT_UNLOCK_LEVEL);
    const walletFirstBuy = XP_ACTIONS.account_created.amount + XP_ACTIONS.pour_in.amount;
    expect(rankForXp(walletFirstBuy).level).toBeGreaterThanOrEqual(CHAT_UNLOCK_LEVEL);
    expect(rankForXp(XP_ACTIONS.account_created.amount).level).toBeLessThan(CHAT_UNLOCK_LEVEL);
  });
});
