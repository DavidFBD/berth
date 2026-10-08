import { describe, expect, it } from "vitest";
import { avatarShelf, carryMore, compareXp, dayLabel, saluteDirection, saluteLanded } from "./profile-more";
import { AVATARS, canUseAvatar } from "./avatars";
import { RANKS } from "./xp";
import { COPY } from "./copy";
import type { CardAnswer } from "./social-types";

const card = { handle: "mira_k", avatarId: null, xp: 900, memberSince: "2026-09", salutes: 1 };
const viewer = { relation: "friends" as const, saluted: false, hasEmail: true, hasHandle: true };

describe("compareXp", () => {
  it("says ahead, behind or level, in whole XP", () => {
    expect(compareXp(1020, 900)).toEqual({ kind: "ahead", xp: 120 });
    expect(compareXp(780, 900)).toEqual({ kind: "behind", xp: 120 });
    expect(compareXp(900, 900)).toEqual({ kind: "level" });
  });
});

describe("carryMore", () => {
  const previous: CardAnswer = { found: true, card, viewer, more: { yourXp: 500 } };

  it("keeps the extras across an action that left the relation as it was", () => {
    const next: CardAnswer = { found: true, card: { ...card, salutes: 2 }, viewer: { ...viewer, saluted: true } };
    expect(carryMore(previous, next)).toEqual({ ...next, more: { yourXp: 500 } });
  });

  it("keeps only the viewer's own XP when the relation changed", () => {
    const next: CardAnswer = { found: true, card, viewer: { ...viewer, relation: "none" } };
    expect(carryMore(previous, next)).toEqual({ ...next, more: { yourXp: 500 } });
  });

  it("carries nothing to a card that cannot be shown, or to another person", () => {
    expect(carryMore(previous, { found: false })).toEqual({ found: false });
    const other: CardAnswer = { found: true, card: { ...card, handle: "juno" }, viewer };
    expect(carryMore(previous, other)).toBe(other);
  });

  it("moves the Salutes between the two at once when a Salute is given or taken back", () => {
    const before: CardAnswer = { found: true, card, viewer, more: { yourXp: 500, salutesBetween: 1 } };
    const given: CardAnswer = { found: true, card, viewer: { ...viewer, saluted: true } };
    expect(carryMore(before, given)).toEqual({ ...given, more: { yourXp: 500, salutesBetween: 2 } });
    const after: CardAnswer = { found: true, card, viewer: { ...viewer, saluted: true }, more: { salutesBetween: 2 } };
    const takenBack: CardAnswer = { found: true, card, viewer };
    expect(carryMore(after, takenBack)).toEqual({ ...takenBack, more: { salutesBetween: 1 } });
  });

  it("prefers fresh extras when the answer has its own", () => {
    const next: CardAnswer = { found: true, card, viewer, more: { yourXp: 700 } };
    expect(carryMore(previous, next)).toBe(next);
  });
});

describe("avatarShelf", () => {
  it("opens the eight open faces from the first rung and keeps the three rank faces as silhouettes", () => {
    const shelf = avatarShelf(0, "lantern");
    expect(shelf).toHaveLength(AVATARS.length);
    expect(shelf.filter((face) => face.open)).toHaveLength(8);
    const locked = shelf.filter((face) => !face.open);
    expect(locked.map((face) => [face.label, face.opensAt])).toEqual([
      ["The Blue Crab", "Pier"],
      ["The Porpoise", "Quay"],
      ["The Blue Lobster", "Harbour Master"],
    ]);
    expect(locked.every((face) => face.src.startsWith("/avatars/locked/"))).toBe(true);
    expect(shelf.find((face) => face.wearing)?.id).toBe("lantern");
  });

  it("opens each rank face at its rung, by the same rule as the picker", () => {
    for (const rank of RANKS) {
      const shelf = avatarShelf(rank.xp, null);
      for (const face of shelf) expect(face.open).toBe(canUseAvatar(face.id, rank.level));
    }
    expect(avatarShelf(RANKS[6].xp, null).find((face) => face.id === "beacon")?.open).toBe(true);
    expect(avatarShelf(RANKS[6].xp - 1, null).find((face) => face.id === "beacon")?.open).toBe(false);
    expect(avatarShelf(RANKS[9].xp, null).every((face) => face.open)).toBe(true);
  });

  it("reads a tea era face id as the creature in its place, and never wears a locked face", () => {
    expect(avatarShelf(0, "teapot").find((face) => face.wearing)?.id).toBe("lantern");
    expect(avatarShelf(0, "capstan").some((face) => face.wearing)).toBe(false);
  });
});

describe("dayLabel", () => {
  const now = new Date("2026-10-09T12:00:00Z");
  it("reads a day as day and short month, keeping the year only when it is another", () => {
    expect(dayLabel("2026-10-03", now)).toBe("3 Oct");
    expect(dayLabel("2025-12-31", now)).toBe("31 Dec 2025");
    expect(dayLabel("nonsense", now)).toBe("nonsense");
  });
});

describe("saluteLanded", () => {
  it("is true only when the answer shows the Salute as asked", () => {
    expect(saluteLanded({ found: true, card, viewer: { ...viewer, saluted: true } }, true)).toBe(true);
    expect(saluteLanded({ found: true, card, viewer }, false)).toBe(true);
  });

  it("is false for a refusal: no answer (a 429 or a network error), a card no longer shown, or the Salute not standing", () => {
    expect(saluteLanded(null, true)).toBe(false);
    expect(saluteLanded({ found: false }, true)).toBe(false);
    expect(saluteLanded({ found: true, card, viewer }, true)).toBe(false);
  });
});

describe("saluteDirection", () => {
  it("says which way the Salutes stand, one per giver at most", () => {
    expect(saluteDirection(0, false)).toBe("none");
    expect(saluteDirection(1, true)).toBe("you");
    expect(saluteDirection(1, false)).toBe("them");
    expect(saluteDirection(2, true)).toBe("each");
  });

  it("reads plainly in the copy, with the name", () => {
    const words = COPY.social.profileSalutesBetween;
    expect(words("you", "mira_k")).toBe("You saluted mira_k.");
    expect(words("them", "mira_k")).toBe("mira_k saluted you.");
    expect(words("each", "mira_k")).toBe("You and mira_k have saluted each other.");
    expect(words("none", "mira_k")).toBe("No Salutes between you yet.");
  });
});
