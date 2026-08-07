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
  /** The account's own invite code; null only until the first profile sync mints it. */
  referralCode: string | null;
};

/** A payout the server made in THIS response. Refetches stay quiet. */
export type Reward = { kind: XpKind; amount: number };

export type RewardList = Reward[];

export type ProfileResponse = Profile & { rewards: RewardList };
