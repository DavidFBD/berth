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
    };

/** The signed in person's own social state, for the account drawer. */
export type MySocial = {
  hasEmail: boolean;
  handle: string | null;
  visible: boolean;
  /** "Show my avatar, username and rank on links I share": off by default; covers the profile and the invite card. */
  linkFace: boolean;
  /** "Let my friends see which stocks and funds I hold": off by default (lib/server/social-proof). */
  shareHoldings: boolean;
  /** When the username may change again; null when it may now. */
  nextChangeAt: string | null;
  /** Friend requests waiting for an answer. */
  requests: number;
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
  /** XP from friends joining and trading this month, after the 250 cap. */
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
