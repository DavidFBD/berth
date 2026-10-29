/**
 * The kinds of email Berth sends, and what each defaults to. Shared by the
 * server (lib/server/email) and the settings drawer's Email section.
 *
 * Security notices are always on: a wallet added or removed, accounts
 * merged, an assistant connected. So are account notices, about money
 * that is the person's own and not an order: a campaign reward paid to
 * the account. Neither can be switched off, so they have no switch, no
 * row in email_prefs and no unsubscribe link. Everything else is a switch.
 * The weekly summary (lib/server/weekly, Monday mornings) is off by
 * default: it is the one kind the person did not trigger, so it goes only
 * to someone who switched it on.
 *
 * New stocks (lib/server/new-listings) is marketing: an email naming stocks
 * Berth added, written and sent by a staff admin (/staff/emails), never
 * automatically. It is never sent as a service or security notice. Under
 * the EU soft opt in (ePrivacy art. 13(2)) it is on by default only for
 * someone who has a filled order AND accepted the 30 October 2026 terms,
 * which told them of it (lib/server/email/store listingsDefaultOnSql), and
 * off for everyone else until they switch it on; their own row always
 * wins. Every one carries the one click unsubscribe. David's calls
 * 2026-10-29.
 */
export const EMAIL_KINDS = ["security", "account", "orders", "friends", "weekly", "listings"] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

/** The kinds sent whatever the email settings say: no switch, no unsubscribe link. */
export const ALWAYS_SENT_KINDS = ["security", "account"] as const;
export type AlwaysSentKind = (typeof ALWAYS_SENT_KINDS)[number];

export function isAlwaysSent(kind: EmailKind): kind is AlwaysSentKind {
  return (ALWAYS_SENT_KINDS as readonly string[]).includes(kind);
}

export const SWITCHABLE_KINDS = ["orders", "friends", "weekly", "listings"] as const;
export type SwitchableKind = (typeof SWITCHABLE_KINDS)[number];

/**
 * Kinds Berth no longer sends. Their rows in email_prefs stay, unread, and
 * an old email's unsubscribe link for one still opens a calm page that
 * says there is nothing left to turn off. "recurring" was the recurring
 * buy reminder, retired 2026-10-04 (docs/adr/0007).
 */
export const RETIRED_KINDS = ["recurring"] as const;
export type RetiredKind = (typeof RETIRED_KINDS)[number];

export function isRetiredKind(value: unknown): value is RetiredKind {
  return typeof value === "string" && (RETIRED_KINDS as readonly string[]).includes(value);
}

/**
 * What a switch is with no row in email_prefs. `listings` is the default
 * for someone the consent rule does not cover; readPrefs turns it on for
 * someone it does (the soft opt in above).
 */
export const DEFAULT_EMAIL_PREFS: Readonly<Record<SwitchableKind, boolean>> = {
  orders: true,
  friends: true,
  weekly: false,
  listings: false,
};

export type EmailPrefs = Record<SwitchableKind, boolean>;

export function isSwitchableKind(value: unknown): value is SwitchableKind {
  return typeof value === "string" && (SWITCHABLE_KINDS as readonly string[]).includes(value);
}

/** What the settings drawer reads (app/api/account/email). */
export type EmailSettingsResponse = {
  /** The verified primary email the notices go to, or null for an account without one. */
  address: string | null;
  /** False when mail to that address bounced or was reported: nothing more is sent. */
  deliverable: boolean;
  prefs: EmailPrefs;
};
