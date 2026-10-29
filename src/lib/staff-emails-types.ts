import type { DraftWords } from "@/lib/new-listings-draft";

/**
 * What the staff emails page (app/staff/emails) and its endpoint
 * (app/api/staff/emails) say to each other. Plain data, no account ids and
 * no full addresses: a person on the list is a masked address and an opaque
 * key.
 */

export type StaffStock = { symbol: string; name: string };

export type StaffRecipient = {
  key: string;
  label: string | null;
  masked: string;
  why: "Filled an order" | "Turned it on";
  excluded: boolean;
};

export type StaffAnnouncement = {
  id: string;
  status: "draft" | "sending" | "done" | "cancelled";
  words: DraftWords;
  /** Every stock detected for it, with whether it is ticked. */
  stocks: (StaffStock & { ticked: boolean })[];
  createdAt: string;
  queuedAt: string | null;
  finishedAt: string | null;
  /** Sends that did not go, by reason ("pref_off", "suppressed", ...): counted as they happened. */
  progress: { sent: number; waiting: number; notSent: { count: number; reasons: Record<string, number> }; notReached: number | null };
};

export type StaffEmailsState = {
  /** The new stocks Berth sees and has not announced, by name. */
  detected: StaffStock[];
  /** False while EMAIL_NEW_LISTINGS is "off". */
  switchOn: boolean;
  /** False outside production: line up, queue, test and send are refused there. */
  production: boolean;
  /** False until production has recorded its baseline (the first look in production does). */
  baselineRecorded: boolean;
  /** The day's New stocks share of the cap, and what has used it. */
  today: { cap: number; used: number };
  /** When the last announcement was queued, for the under 7 days warning. */
  lastQueuedAt: string | null;
  /** The last announcement that reached people was queued under 7 days ago: queuing another is refused. */
  recentlyQueued: boolean;
  /** The draft, or the announcement being sent. */
  current: (StaffAnnouncement & {
    /** The first rows of the list (a long list is cut), with everyone's count below. */
    recipients: StaffRecipient[];
    /** Who the email would go to, counted in SQL over everyone (taken off and unusable addresses not counted). */
    sendCount: number;
    /** Everyone on the list, taken off included: more than recipients.length when the list is cut. */
    recipientTotal: number;
    /** What staff approve: sent back with the press of send, so a draft changed meanwhile is refused. */
    hash: string;
  }) | null;
  history: StaffAnnouncement[];
};

export type StaffEmailsResult = { ok: boolean; reason?: string; problems?: string[]; detail?: Record<string, unknown> };

/** `state` is null when it could not be read after the act: the page asks again. */
export type StaffEmailsResponse = { state: StaffEmailsState | null; result?: StaffEmailsResult };

/** The answer to `{ action: "preview" }`. */
export type StaffEmailsPreview = { subject: string; html: string };
