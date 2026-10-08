import { AVATARS, avatarLockedSrc, avatarUnlockLevel, resolveAvatarId, type AvatarId } from "@/lib/avatars";
import { RANKS, rankForXp } from "@/lib/xp";
import type { CardAnswer } from "@/lib/social-types";

/**
 * The profile page's extras (CardAnswer.more) across an action. An action's
 * answer is the plain card, without the extras; the page refetches them a
 * moment later. Until then the previous extras are carried over, so the
 * sections under the card do not blink out and back. Only while the two
 * still stand where they did: a changed relation carries nothing but the
 * viewer's own XP, since the rest belongs to friends.
 */
export function carryMore(previous: CardAnswer | undefined, next: CardAnswer): CardAnswer {
  if (!next.found || next.more || !previous?.found || !previous.more) return next;
  if (previous.card.handle !== next.card.handle) return next;
  if (previous.viewer.relation !== next.viewer.relation) {
    return previous.more.yourXp === undefined ? next : { ...next, more: { yourXp: previous.more.yourXp } };
  }
  // A Salute given or taken back moves the count between the two at once.
  const between = previous.more.salutesBetween;
  const moved = Number(next.viewer.saluted) - Number(previous.viewer.saluted);
  if (between !== undefined && moved !== 0) {
    return { ...next, more: { ...previous.more, salutesBetween: Math.min(Math.max(between + moved, 0), 2) } };
  }
  return { ...next, more: previous.more };
}

export type XpStanding = { kind: "ahead" | "behind"; xp: number } | { kind: "level" };

/** Where the viewer stands against the card, in XP: the ladder's comparison line. */
export function compareXp(yourXp: number, theirXp: number): XpStanding {
  const gap = Math.round(yourXp) - Math.round(theirXp);
  if (gap > 0) return { kind: "ahead", xp: gap };
  if (gap < 0) return { kind: "behind", xp: -gap };
  return { kind: "level" };
}

export type ShelfFace = {
  id: AvatarId;
  /** "The Seal". */
  label: string;
  src: string;
  open: boolean;
  /** The rung that opens a face still locked; null for an open one. */
  opensAt: string | null;
  wearing: boolean;
};

/**
 * Every face on the shelf as someone at `xp` sees it: open from their rank
 * (lib/avatars unlockLevel, the same rule the picker and the server hold),
 * or its own flat silhouette (public/avatars/locked) with the rung that
 * opens it. Read from the card's XP and face alone.
 */
export function avatarShelf(xp: number, avatarId: string | null): ShelfFace[] {
  const level = rankForXp(xp).level;
  const worn = resolveAvatarId(avatarId);
  return AVATARS.map((avatar) => {
    const unlock = avatarUnlockLevel(avatar.id);
    const open = level >= unlock;
    return {
      id: avatar.id,
      label: avatar.label,
      src: open ? avatar.src : (avatarLockedSrc(avatar.id) ?? avatar.src),
      open,
      opensAt: open ? null : RANKS[unlock - 1].name,
      wearing: open && worn === avatar.id,
    };
  });
}

/**
 * A moment's day, "2026-10-03", as "3 Oct"; a day in another year than
 * `now` keeps its year, "3 Oct 2025". Read in UTC, as it was written.
 */
export function dayLabel(on: string, now = new Date()): string {
  const date = new Date(`${on}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return on;
  const sameYear = date.getUTCFullYear() === now.getUTCFullYear();
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }), timeZone: "UTC" });
}

/**
 * Whether a Salute (or taking one back) landed: the action answered with
 * the card, showing the Salute as asked. A refusal (a 429, a network error,
 * a card no longer shown) is null or another answer, so the tick that
 * acknowledges a Salute is cleared rather than played later without a tap.
 */
export function saluteLanded(next: CardAnswer | null, on: boolean): boolean {
  return next?.found === true && next.viewer.saluted === on;
}

export type SaluteDirection = "none" | "you" | "them" | "each";

/**
 * Which way the Salutes between the two stand. One per giver at most, so
 * the count (0 to 2) and whether the viewer's own stands say it all.
 */
export function saluteDirection(between: number, youSaluted: boolean): SaluteDirection {
  const theirs = between - (youSaluted ? 1 : 0) > 0;
  if (youSaluted && theirs) return "each";
  if (youSaluted) return "you";
  if (theirs) return "them";
  return "none";
}
