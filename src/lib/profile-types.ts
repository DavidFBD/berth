import type { XpKind } from "@/lib/xp";

/**
 * The profile envelope, shared by both sides of the wire. The server builds
 * it (accounts.toProfile plus the rewards list), the client caches it
 * (use-profile) — one module so neither side re-types the shape by hand, and
 * `kind` keeps the XpKind union instead of decaying to string at the
 * boundary.
 */
export type Profile = {
  xp: number;
  avatarId: string | null;
  hasEmail: boolean;
  /**
   * The account's own invite code. Null until the first profile sync mints
   * it AND the account has reached INVITE_UNLOCK_LEVEL — below that rank the
   * server keeps the minted code to itself and the client shows the lock.
   */
  referralCode: string | null;
};

/** A payout the server made in THIS response. Refetches stay quiet. */
export type Reward = { kind: XpKind; amount: number };

export type RewardList = Reward[];

export type ProfileResponse = Profile & { rewards: RewardList };

/**
 * The referral corner's own envelope (/api/referral/panel): who set your
 * seat, whether you can still claim a code by hand, and how your own
 * invitations are brewing. Fetched separately from the profile so the hot
 * XP routes stay one-query cheap.
 */
export type ReferralPanel = {
  /** Set when this account arrived on someone's invite. */
  invitedBy: {
    avatarId: string | null;
    level: number;
    /** Whether the shared first-pour reward has already paid out. */
    firstPourPaid: boolean;
  } | null;
  /**
   * A stripped link's recovery hatch: true while the account is young,
   * unclaimed, and unpoured, so a hand-typed code can still bind.
   */
  canClaim: boolean;
  stats: {
    /** Invite-link landings (page loads, not people). */
    taps: number;
    /** Accounts born holding this account's code. */
    seated: number;
    /** Of those, how many have poured a first verified cup. */
    poured: number;
    /** friend_poured XP actually banked. */
    earnedXp: number;
    /** XP waiting on seated friends who have not poured yet. */
    steepingXp: number;
  };
};

/** One ledger line (/api/xp/history): why, how much, when. */
export type XpHistoryEntry = { kind: XpKind; amount: number; at: string };

export type XpHistoryResponse = { events: XpHistoryEntry[] };
