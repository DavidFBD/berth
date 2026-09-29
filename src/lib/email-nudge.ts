/**
 * The quiet strip asking a wallet-only account (no verified email) to add
 * one, so it can keep its account and pick a username
 * (docs/plans/social.md: a username needs a verified email). Pure show/hide
 * rule, shared by the hook (hooks/use-email-nudge) and its tests.
 *
 * It earns its place the same way the other account lines do: after the
 * account has done something (a first buy), or after two visits if it
 * hasn't. Dismissing it is "not now", not "never": it can come back, but
 * not for a week, same as a standing nudge line (lib/nudge's dismissFor).
 *
 * At most one prompt strip shows at a time. The limit-order waiting strip
 * (waiting money) and the unlinked-wallet prompt (an account mix-up) both
 * outrank this one, since this is only ever a suggestion; the caller says
 * so with `otherStripShowing` rather than this module reaching for their
 * state itself.
 */

export type EmailNudgeFacts = {
  /** The account already has a verified email; once true this never shows again. */
  hasEmail: boolean;
  /** The account has bought at least one listing. */
  boughtBefore: boolean;
  /** How many times this browser has loaded the board without a buy yet. */
  visits: number;
  /** When it was last dismissed (epoch ms), or null if never. */
  dismissedAt: number | null;
  /** A higher-priority strip is already showing in the same slot. */
  otherStripShowing: boolean;
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Visits before the line is offered to someone who hasn't bought yet. */
export const VISITS_BEFORE_EARNED = 2;

export function shouldShowEmailNudge(facts: EmailNudgeFacts, now: number): boolean {
  if (facts.hasEmail) return false;
  if (facts.otherStripShowing) return false;
  const earned = facts.boughtBefore || facts.visits >= VISITS_BEFORE_EARNED;
  if (!earned) return false;
  if (facts.dismissedAt !== null && now - facts.dismissedAt < WEEK_MS) return false;
  return true;
}
