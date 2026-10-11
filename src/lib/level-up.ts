import type { RewardList } from "@/lib/profile-types";
import { levelUpRank, rankForXp, REWARD_REASONS } from "@/lib/xp";

/**
 * The level-up takeover's rulebook (components/level-up-takeover draws it).
 * Pure and framework free, so every rule is a unit test:
 *
 *   - What a rank crossing says: the rung reached, the rung left, the XP
 *     that crossed it and, when one reward did, why.
 *   - One queue. Crossings that arrive while the stage is busy fold into
 *     one: the highest rung, from the lowest left, so a jump of two rungs
 *     is one takeover, never two in a row. One that arrives while a
 *     takeover is on screen folds into that one, in place.
 *   - The stage is busy while a signing flow (Privy's window) or an order
 *     drawer is open; the takeover waits there until it closes. It never
 *     gives up waiting: a buy that crossed a rank is celebrated once the
 *     drawer is closed, however long that takes.
 *   - At most once per rung per account: the highest rung celebrated is
 *     kept on the device, so nothing replays on a reload, a second tab or a
 *     reward announced twice.
 *
 * David's call 2026-10-11: the one level-up takeover is an exception to
 * "only the orb animates" (CLAUDE.md, Brand), under two seconds, then a
 * still card.
 */

export type Celebration = {
  /** The rung reached. */
  level: number;
  rankName: string;
  /** The rung left behind; several rungs can pass at once. */
  fromLevel: number;
  /** The XP that crossed it. */
  total: number;
  /** One reward's reason ("for a buy"), or null when several paid at once. */
  reason: string | null;
  newXp: number;
};

/** The crossing a batch of rewards made, or null when it stayed on its rung. */
export function celebrationFor(rewards: RewardList, newXp: number): Celebration | null {
  const total = rewards.reduce((sum, reward) => sum + reward.amount, 0);
  const reached = levelUpRank(newXp - total, newXp);
  if (!reached) return null;
  return {
    level: reached.level,
    rankName: reached.name,
    fromLevel: rankForXp(newXp - total).level,
    total,
    reason: rewards.length === 1 ? REWARD_REASONS[rewards[0].kind] : null,
    newXp,
  };
}

/** Two crossings waiting together are one: the highest rung, from the lowest left, the XP of both. */
export function foldCelebrations(a: Celebration, b: Celebration): Celebration {
  const top = b.level >= a.level ? b : a;
  return {
    level: top.level,
    rankName: top.rankName,
    fromLevel: Math.min(a.fromLevel, b.fromLevel),
    total: a.total + b.total,
    reason: null,
    newXp: Math.max(a.newXp, b.newXp),
  };
}

/**
 * The timing, in seconds. Everything moving has settled by SETTLED_S,
 * under two seconds; after that the card is still until it is dismissed.
 */
export const TAKEOVER = {
  scrim: { duration: 0.18 },
  card: { duration: 0.32 },
  face: { delay: 0.12, duration: 0.38 },
  /** Two rings of the rank's own glyph, in ink, opening out and fading. */
  burst: [
    { delay: 0.2, duration: 0.9 },
    { delay: 0.34, duration: 0.95 },
  ],
  words: { delay: 0.36, duration: 0.32 },
  unlocks: { delay: 0.5, step: 0.1, duration: 0.3 },
  action: { delay: 0.7, duration: 0.3 },
} as const;

/** When the last motion ends (the second ring); kept under two seconds by a test. */
export const SETTLED_S = Math.max(
  ...TAKEOVER.burst.map((ring) => ring.delay + ring.duration),
  TAKEOVER.action.delay + TAKEOVER.action.duration,
);

/** What holds the takeover back: a signing window (Privy) or an order drawer. */
export const STAGE_BUSY_SELECTOR = [
  "[data-order-drawer]",
  "#privy-dialog",
  '[id^="privy-dialog"]',
  '#privy-modal-root [role="dialog"]',
  'div[id^="privy-modal"]',
].join(", ");

export function stageBusy(root: Pick<Document, "querySelector"> | undefined): boolean {
  if (!root) return false;
  return root.querySelector(STAGE_BUSY_SELECTOR) !== null;
}

/** Where the highest rung celebrated is kept, per account; null while the account is not known. */
export function seenLevelKey(accountKey: string | null): string | null {
  return accountKey ? `berth.level-celebrated.${accountKey.toLowerCase()}` : null;
}

/** Whether `level` is new to this account on this device. */
export function isNewLevel(seen: string | null, level: number): boolean {
  const before = seen === null ? 0 : Number.parseInt(seen, 10);
  return !(Number.isFinite(before) && before >= level);
}

type Listener = () => void;

/**
 * The one queue between lib/toast (which learns of a crossing) and the
 * takeover (which shows it). `push` answers false when no takeover is
 * mounted, so the caller can fall back to the plain level-up toast and a
 * crossing is never swallowed.
 */
export class CelebrationQueue {
  private pending: Celebration | null = null;
  private listeners = new Set<Listener>();

  push(celebration: Celebration): boolean {
    if (this.listeners.size === 0) return false;
    this.pending = this.pending ? foldCelebrations(this.pending, celebration) : celebration;
    for (const listener of this.listeners) listener();
    return true;
  }

  /** What waits, folded into one, without taking it. */
  peek(): Celebration | null {
    return this.pending;
  }

  /** Take what waits; it is the renderer's from here. */
  take(): Celebration | null {
    const next = this.pending;
    this.pending = null;
    return next;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export const celebrations = new CelebrationQueue();

/**
 * What the takeover does with an event while it is open, so the drawer it
 * may sit over (the account drawer, where the friend features are turned
 * on) never sees it. The takeover listens on window in the capture phase,
 * ahead of every drawer's own listeners, and:
 *
 *   - "close": Esc anywhere, or a click on the scrim or on Nice. Closed by
 *     the takeover itself and stopped there, so the drawer stays open.
 *   - "trap": Tab, which keeps the focus inside the takeover.
 *   - "swallow": any other key, and any press, touch or focus move inside
 *     the takeover. Stopped, so no drawer reads it as a press outside it
 *     or pulls the focus back; the browser's own default (a button's click
 *     on Enter, focus on press) still happens.
 *   - "pass": anything else, which never happens while it covers the screen.
 */
export type TakeoverEventAction = "close" | "trap" | "swallow" | "pass";

export function takeoverEventAction(event: {
  type: string;
  key?: string;
  /** The event's target, or a focusout's relatedTarget, is inside the takeover. */
  inside: boolean;
  /** The click landed on the scrim or on Nice. */
  onClose?: boolean;
}): TakeoverEventAction {
  if (event.type === "keydown") {
    if (event.key === "Escape") return "close";
    if (event.key === "Tab") return "trap";
    return "swallow";
  }
  if (!event.inside) return "pass";
  if (event.type === "click") return event.onClose ? "close" : "swallow";
  return "swallow";
}

/** The events the takeover holds on window while it is open. */
export const TAKEOVER_EVENTS = [
  "keydown",
  "keyup",
  "pointerdown",
  "pointerup",
  "mousedown",
  "mouseup",
  "touchstart",
  "touchend",
  "click",
  "focusin",
  "focusout",
] as const;
