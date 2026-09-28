/**
 * The rewards system, shared by server (award rules) and client (display).
 *
 * Values live here and nowhere else. Server routes import the amounts so the
 * client can never invent its own numbers; the client imports the curve so
 * progress bars match what the ledger will actually say.
 */

/** Everything that can earn XP, with how much and how often. */
export const XP_ACTIONS = {
  /** A pour into a cup, deduped by the intent's hub tx hash. */
  pour_in: { amount: 100, once: false },
  /** A pour back out, same dedup. Both directions are part of playing. */
  pour_out: { amount: 100, once: false },
  /** First time we see this account. */
  account_created: { amount: 25, once: true },
  /** An email lands on the account (sign-in or later linking). */
  email_linked: { amount: 150, once: true },
  /** Picking a face for the pantry, once. */
  avatar_set: { amount: 25, once: true },
  /**
   * Trying a mode for the first time. Repeatable kind, but the dedup ref is
   * `userId:modeId`, so each theme pays exactly once per account — the whole
   * ladder caps at modes × 10 XP no matter how much the switch is toggled.
   */
  theme_tried: { amount: 10, once: false },
  /**
   * A friend you invited poured their first cup. Paid to the REFERRER; the
   * dedup ref is the referred account's id, so each friend pays exactly once
   * no matter how many pours they go on to make. The trigger is a verified
   * on-chain pour, not a signup — accounts are free to mint, pours are not,
   * which is what makes the referral worth anything.
   */
  friend_poured: { amount: 250, once: false },
  /**
   * The referred side of the same moment: your first pour, having arrived
   * via a friend's link. Once per account. Same amount as the referrer on
   * purpose (David's call): an invitation reads better when both chairs at
   * the table are worth the same.
   */
  invite_accepted: { amount: 250, once: true },
  /**
   * A buy still on the books thirty days later. Paid once per pour (the
   * dedup ref is the pour's own tx hash), awarded by the daily cron after
   * it re-reads the position on chain, and parked unannounced so the toast
   * fires the next time the account is actually looking. Patience is the
   * one thing a berth is for; no daily streak will ever sit beside it.
   */
  held_30_days: { amount: 150, once: false },
} as const;

export type XpKind = keyof typeof XP_ACTIONS;

/**
 * Handing out your own invite link is itself a rank perk (David's call,
 * field-tested 2026-08-07): a referred newcomer arrives at level 2 and the
 * locked invite row becomes their next goal. Server gates the code in
 * toProfile; the client only decides how to say it.
 */
export const INVITE_UNLOCK_LEVEL = 3;

/**
 * The in-app assistant (app/api/chat) opens at Slip, the first rung: an
 * email sign in (25 + 150 XP) lands there at once, and a wallet account
 * reaches it with its first buy (100 XP). Low enough that nobody works for
 * it, high enough that a freshly minted wallet cannot spend the house's
 * model budget before it has done anything. The server refuses below it
 * (app/api/chat); the client only decides how to say so.
 */
export const CHAT_UNLOCK_LEVEL = 2;

export function isXpKind(value: string): value is XpKind {
  return value in XP_ACTIONS;
}

/**
 * Why each kind pays, in toast-sized words — the ladder owns its own
 * vocabulary, and the announcer and the house ledger both read from here.
 * Deliberately theme-agnostic, like everything rewards (see ADR-0001).
 */
export const REWARD_REASONS: Record<XpKind, string> = {
  pour_in: "for a buy",
  pour_out: "for a sell",
  account_created: "for opening your account",
  email_linked: "for adding an email",
  avatar_set: "for picking an avatar",
  theme_tried: "for trying another appearance",
  friend_poured: "a friend made their first trade",
  invite_accepted: "for joining on a friend's invite",
  held_30_days: "for holding thirty days",
};

/**
 * Rank ladder. Names are deliberately theme-agnostic: personalities restyle
 * the app's voice, but your rank is your rank in every parlour.
 */
export const RANKS = [
  { level: 1, xp: 0, name: "First Line" },
  { level: 2, xp: 100, name: "Slip" },
  { level: 3, xp: 250, name: "Berth Holder" },
  { level: 4, xp: 500, name: "Cleat" },
  { level: 5, xp: 900, name: "Mooring Ring" },
  { level: 6, xp: 1500, name: "Double Berth" },
  { level: 7, xp: 2400, name: "Pier" },
  { level: 8, xp: 3600, name: "Quay" },
  { level: 9, xp: 5200, name: "Harbour Warden" },
  { level: 10, xp: 7500, name: "Harbour Master" },
] as const;

/**
 * The rank's glyph from the brand kit, one per rung, served from
 * public/ranks (copied from public/berth-brand/app/ranks so the kit stays
 * the untouched source). Levels off the ladder clamp to the ends.
 */
export function rankGlyphSrc(level: number): string {
  const n = Math.min(Math.max(Math.round(level), 1), RANKS.length);
  return `/ranks/rank-${String(n).padStart(2, "0")}.svg`;
}

export type RankInfo = {
  level: number;
  name: string;
  /** XP into the current level. */
  into: number;
  /** XP span of the current level; 0 at the top of the ladder. */
  span: number;
  /** 0..1 progress toward the next rank; 1 at the top. */
  progress: number;
  nextName: string | null;
};

/** Where a given XP total sits on the ladder. */
export function rankForXp(xp: number): RankInfo {
  let current: (typeof RANKS)[number] = RANKS[0];
  let next: (typeof RANKS)[number] | null = null;
  for (const rank of RANKS) {
    if (xp >= rank.xp) current = rank;
    else {
      next = rank;
      break;
    }
  }
  const span = next ? next.xp - current.xp : 0;
  const into = xp - current.xp;
  return {
    level: current.level,
    name: current.name,
    into,
    span,
    progress: next ? Math.min(into / span, 1) : 1,
    nextName: next?.name ?? null,
  };
}

/**
 * Whether an XP change crossed a rank boundary: the rank arrived at when it
 * did, null when it stayed on the same rung. The announcer derives the
 * before-total itself (new total minus the response's rewards), so both
 * arguments are always real numbers — no missing-total escape hatch.
 */
export function levelUpRank(oldXp: number, newXp: number): RankInfo | null {
  const after = rankForXp(newXp);
  return rankForXp(oldXp).level < after.level ? after : null;
}
