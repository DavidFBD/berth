/**
 * The account drawer's one next step (components/account-drawer), decided
 * here so the order is tested: an avatar, then (a wallet account) an email,
 * then a username, then a friend. One at a time, and none for an account
 * that has done them or is past the welcome.
 */

export type NextStep = "avatar" | "email" | "username" | "invite" | null;

/** The invite step is a welcome: below this rank, or this young. */
export const INVITE_STEP_BELOW_LEVEL = 3;
export const INVITE_STEP_DAYS = 14;

export function chooseNextStep(input: {
  kind: "email" | "wallet";
  /** Profile loaded. */
  avatarId: string | null;
  hasEmail: boolean;
  /** The add-email flow was asked for (the email nudge, or a row offering it). */
  emailAsked: boolean;
  /** Social state, once loaded (null while it loads). */
  social: { hasEmail: boolean; handle: string | null } | null;
  /** Friends plus requests sent, once loaded (null while it loads). */
  friendsAndSent: number | null;
  level: number;
  /** Days since the account opened, when known. */
  ageDays: number | null;
  inviteDismissed: boolean;
}): NextStep {
  const walletWithoutEmail = input.kind === "wallet" && !input.hasEmail;
  if (walletWithoutEmail && input.emailAsked) return "email";
  if (input.avatarId == null) return "avatar";
  // A username needs an email, so a wallet account adds one first.
  if (walletWithoutEmail) return "email";
  if (!input.social) return null;
  if (input.social.hasEmail && !input.social.handle) return "username";
  const young = input.level < INVITE_STEP_BELOW_LEVEL || (input.ageDays !== null && input.ageDays < INVITE_STEP_DAYS);
  // Fewer than two: the friend an invite makes (the inviter) still leaves the step its point.
  if (input.social.handle && young && !input.inviteDismissed && input.friendsAndSent !== null && input.friendsAndSent < 2) {
    return "invite";
  }
  return null;
}

/** Where "Not now" on the invite step is kept: per account, so another account in this browser still sees it. */
export function inviteDismissKey(account: string): string {
  return `berth.drawer-invite-dismissed:${account.toLowerCase()}`;
}
