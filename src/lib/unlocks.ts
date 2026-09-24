/**
 * What each rung of the ladder opens, stated once so the ladder caption in
 * the rewards drawer and the level-up card can never disagree. Derived from
 * the two sources that already own the rules (INVITE_UNLOCK_LEVEL in
 * lib/xp, `unlockLevel` on the faces in lib/avatars), so a face that moves
 * to another rung moves here too. Pure data; the words live in lib/copy.
 */
import { AVATARS, type AvatarId } from "@/lib/avatars";
import { INVITE_UNLOCK_LEVEL, RANKS } from "@/lib/xp";

export type Unlock =
  | { kind: "invite" }
  /** `face` is the face's short name, "Beacon", for "the Beacon face". */
  | { kind: "avatar"; avatarId: AvatarId; face: string };

function unlocksByLevel(): ReadonlyMap<number, Unlock> {
  const map = new Map<number, Unlock>();
  map.set(INVITE_UNLOCK_LEVEL, { kind: "invite" });
  for (const avatar of AVATARS) {
    if (!("unlockLevel" in avatar)) continue;
    map.set(avatar.unlockLevel, {
      kind: "avatar",
      avatarId: avatar.id,
      face: avatar.label.replace(/^The /, ""),
    });
  }
  return map;
}

const UNLOCKS = unlocksByLevel();

/** What reaching `level` opens, or null for a rung that opens nothing. */
export function unlockAt(level: number): Unlock | null {
  return UNLOCKS.get(level) ?? null;
}

/**
 * Everything opened on the way from `oldLevel` to `newLevel`: each unlock
 * with oldLevel < level <= newLevel, lowest rung first. A jump of several
 * rungs at once (a parked reward landing with a fresh one) can pass more
 * than one opening; the last entry is the most recent.
 */
export function unlocksBetween(oldLevel: number, newLevel: number): Unlock[] {
  return unlockLevels()
    .filter((level) => level > oldLevel && level <= newLevel)
    .map((level) => UNLOCKS.get(level)!);
}

/** Every rung that opens something, in ladder order. */
export function unlockLevels(): number[] {
  return RANKS.map((rank) => rank.level).filter((level) => UNLOCKS.has(level));
}
