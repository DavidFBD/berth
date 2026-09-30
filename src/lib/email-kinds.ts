/**
 * The kinds of email Berth sends, and what each defaults to. Shared by the
 * server (lib/server/email) and the settings drawer's Email section.
 *
 * Security notices are always on: a wallet added or removed, accounts
 * merged, an assistant connected. They cannot be switched off, so they
 * have no switch and no row in email_prefs. Everything else is a switch.
 * The weekly summary is stored but not sent yet, and is off by default:
 * it is the one kind the person did not trigger.
 */
export const EMAIL_KINDS = ["security", "orders", "friends", "weekly", "recurring"] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

export const SWITCHABLE_KINDS = ["orders", "friends", "weekly", "recurring"] as const;
export type SwitchableKind = (typeof SWITCHABLE_KINDS)[number];

export const DEFAULT_EMAIL_PREFS: Readonly<Record<SwitchableKind, boolean>> = {
  orders: true,
  friends: true,
  weekly: false,
  // Only sent to someone who set a plan (docs/adr/0007), so on until they say otherwise.
  recurring: true,
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
