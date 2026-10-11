import type { MySocial } from "@/lib/social-types";

/**
 * "Turn on all friend features" (lib/server/social/handles setAllFriends),
 * judged on the client from the viewer's own social state. The friend
 * features are the drawer's four privacy switches, each in its sharing
 * state: the profile shown (Hide my profile off), Show me on shared links,
 * Share my holdings with friends and Compare weeks with friends. A card
 * staff hid cannot be shown by its owner, so then the other three decide.
 */

export const FRIEND_FEATURES = ["visible", "linkFace", "shareHoldings", "shareWeek"] as const;
export type FriendFeature = (typeof FRIEND_FEATURES)[number];

type Switches = Pick<MySocial, "visible" | "linkFace" | "shareHoldings" | "shareWeek" | "staffHidden">;

export type FriendsAllState = {
  /** How many of the features the person can turn on are on. */
  on: number;
  /** How many the person can turn on (three while staff hide the card). */
  total: number;
  /** Every one of them is on: the "all" offer steps aside. */
  all: boolean;
  /**
   * Some, not all, were chosen: one of the three off-by-default switches is
   * on. The profile is shown by default from the first username, so it
   * alone is not a choice, and a new profile is offered "all", not "the rest".
   */
  partial: boolean;
};

export function friendsAllState(social: Switches): FriendsAllState {
  const features = FRIEND_FEATURES.filter((feature) => !(feature === "visible" && social.staffHidden));
  const on = features.filter((feature) => social[feature]).length;
  const all = on === features.length;
  const chosen = social.linkFace || social.shareHoldings || social.shareWeek;
  return { on, total: features.length, all, partial: !all && chosen };
}

/**
 * The XP promise stands beside the offer only while the bonus is unclaimed
 * and can be paid: never while staff have hidden the card, since no bonus
 * is paid then (lib/server/social/handles).
 */
export function friendsAllPromisesXp(social: Pick<MySocial, "friendsAllClaimed" | "staffHidden">): boolean {
  return social.friendsAllClaimed !== true && social.staffHidden !== true;
}

/**
 * Whether `shown`, the feature ids an offer sent with its tap, is exactly
 * the set the server turns on: every one, once, nothing else.
 */
export function sameFriendFeatures(shown: unknown): shown is FriendFeature[] {
  if (!Array.isArray(shown) || shown.length !== FRIEND_FEATURES.length) return false;
  const set = new Set(shown);
  return set.size === FRIEND_FEATURES.length && FRIEND_FEATURES.every((feature) => set.has(feature));
}
