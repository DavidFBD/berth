import type { HandleRefusal } from "@/lib/handle";

/**
 * The wire shapes of the social routes (app/api/social/[op]), shared by the
 * server (lib/server/social) and the client (hooks/use-social). Nothing here
 * carries money, a wallet, an email or anyone's friends.
 */

/** Where the viewer stands with the person on the card. */
export type Relation = "self" | "none" | "sent" | "received" | "friends";

/** The card: all a stranger may ever learn about an account. */
export type Card = {
  handle: string;
  avatarId: string | null;
  xp: number;
  /** The month the account opened, "2026-09". */
  memberSince: string;
  salutes: number;
};

/** The viewer's side of a card, when someone is signed in. */
export type Viewer = {
  relation: Relation;
  saluted: boolean;
  /** Salutes and friend requests need a verified email. */
  hasEmail: boolean;
  /** Friends need a username on both sides. */
  hasHandle: boolean;
  /** The viewer's own "Let my friends see which stocks and funds I hold" is on: said beside Accept and Add friend. */
  sharesHoldings?: boolean;
};

/**
 * One answer for every card that cannot be shown: missing, hidden, blocked
 * and blocking all read `{ found: false }`, byte for byte. A signed out
 * visitor gets `{ found: false, signIn: true }` for every name, whether or
 * not it is anyone's: no card is ever shown without a session, so signing
 * out cannot get round a block or tell someone they are blocked.
 */
export type CardAnswer =
  | { found: false }
  | { found: false; signIn: true }
  | {
      found: true;
      card: Card;
      viewer: Viewer;
      /**
       * The board listings this friend holds, by symbol, never an amount:
       * only between friends who both turned on "Let my friends see which
       * stocks and funds I hold" (lib/server/social-proof friendHolds).
       * Absent otherwise, and never on a stranger's card.
       */
      holds?: string[];
      /**
       * The profile page's extras (lib/server/social/profile-more), only on
       * the page's own reads (the `card` and `link-card` operations), never
       * on Find a friend or an action's answer.
       */
      more?: ProfileMore;
    };

/**
 * A moment on a profile's short timeline. Dates are days ("2026-10-03",
 * UTC), never times; nothing here carries an amount, an order or a holding.
 */
export type Moment =
  /** The day the account's XP first reached a rung of the ladder. */
  | { kind: "rank"; level: number; on: string }
  /** A Salute between the viewer and this friend, still standing. */
  | { kind: "salute"; from: "you" | "them"; on: string }
  /** The day the two became friends. */
  | { kind: "friends"; on: string }
  /** The month the account opened, as the card already says. */
  | { kind: "joined"; month: string };

/**
 * What the profile page adds to a card. A stranger's card carries only the
 * viewer's own XP, for the ladder's comparison line; everything else needs
 * the two to be friends (or the card to be the viewer's own).
 */
export type ProfileMore = {
  /** The viewer's own XP. Absent on the viewer's own card. */
  yourXp?: number;
  /**
   * Friends and the viewer's own card only: at most five, newest first,
   * the month they joined last.
   */
  moments?: Moment[];
  /** Friends only: the day they became friends. */
  friendsSince?: string;
  /**
   * Friends only: friends of both whose cards the viewer may see, at most
   * four faces and how many more.
   */
  mutual?: { faces: Face[]; more: number };
  /**
   * Friends only, and only while both share what they hold under the same
   * rule as "Your friends hold": the board listings both hold, by symbol.
   */
  bothHold?: string[];
  /** Friends only: the Salutes standing between the two, either way (0 to 2: one each at most). */
  salutesBetween?: number;
};

/** A face in "In common": username, avatar and rank level, as their own card shows them. Never XP. */
export type Face = { handle: string; avatarId: string | null; level: number };

/** The signed in person's own social state, for the account drawer. */
export type MySocial = {
  hasEmail: boolean;
  handle: string | null;
  visible: boolean;
  /** "Show my avatar, username and rank on links I share": off by default; covers the profile and the invite card. */
  linkFace: boolean;
  /** "Let my friends see which stocks and funds I hold": off by default (lib/server/social-proof). */
  shareHoldings: boolean;
  /** "Compare weeks with friends": off by default (lib/server/social/compare). */
  shareWeek: boolean;
  /** When the username may change again; null when it may now. */
  nextChangeAt: string | null;
  /** Friend requests waiting for an answer. */
  requests: number;
  /**
   * The one time friends_all_on XP ("Turn on all friend features") has been
   * paid: the offer then stops promising it. Absent reads as unclaimed.
   */
  friendsAllClaimed?: boolean;
  /**
   * Staff hid the card (moderation): the person's own switches cannot show
   * it, so "all friend features on" is judged without it.
   */
  staffHidden?: true;
};

/**
 * Someone in the viewer's own lists. `hidden`: their card is off, so only
 * the name they had then is given, with no face and no XP.
 */
export type Person = { handle: string; avatarId: string | null; xp: number; hidden?: true };

/** A blocked name, exactly as it was typed, and nothing else. */
export type BlockedName = { handle: string };

export type FriendsList = { friends: Person[]; incoming: Person[]; outgoing: Person[] };

export type BoardRow = Person & {
  you: boolean;
  place: number;
  points: number;
  /** XP from orders this month, after the 300 cap. */
  orderXp: number;
  /** Invite XP this month (friend_stayed, the retired friend_poured, invite_accepted), after the 250 cap. */
  referralXp: number;
  /** Every other kind of XP this month. */
  otherXp: number;
  /** Salutes first given this month, after the 10 cap. */
  salutePoints: number;
};

export type FriendsBoard = { month: string; rows: BoardRow[] };

export type HandleCheck = { ok: true; handle: string } | { ok: false; reason: HandleRefusal };

export type FriendAction = "request" | "cancel" | "accept" | "decline" | "remove";

export type ReportReason = "name" | "impersonation" | "other";

export const REPORT_REASONS: readonly ReportReason[] = ["name", "impersonation", "other"];
