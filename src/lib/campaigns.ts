/**
 * Reward campaigns, the client safe half (the server half is
 * lib/server/campaigns). Since 5 October 2026 a campaign rewards a new
 * account opened through the campaign's own link (/c/<code>), never a buy:
 * a person who opens a new account through the link inside the campaign's
 * dates, sets it up and still uses Berth `stayDays` days later has
 * `amountUsd` in USDC added to their own account, once per person, while
 * places last. A personal invite (/r/<code>) never earns money. Nothing
 * asks for a buy, a holding or a volume. Berth never sends the money
 * itself: David pays each approved claim by hand.
 *
 * The campaign code rulebook lives here, beside the invite code's
 * (lib/invite-code): lowercase letters, digits and hyphens, 3 to 32, never
 * starting with a hyphen. It cannot be confused with an invite code by
 * where it travels (/c/ against /r/), and the pocket is its own.
 */

const CODE_SHAPE = /^[a-z0-9][a-z0-9-]{2,31}$/;

/** The canonical form of a campaign code, or null when it is not one. */
export function normalizeCampaignCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return CODE_SHAPE.test(trimmed) ? trimmed : null;
}

/**
 * Which rules a campaign runs. 'signup' is every campaign since 5 October
 * 2026. 'buy' and 'invite' (which paid the inviter) are retired: their rows
 * stay, read only.
 */
export type CampaignKind = "buy" | "invite" | "signup";

export const CLAIM_STATES = [
  "attributed",
  // Retired with the buy campaigns: never entered by an invite claim.
  "buying",
  "holding",
  "qualified",
  "approved",
  "paid",
  "rejected",
  "expired",
] as const;
export type ClaimState = (typeof CLAIM_STATES)[number];

/** States that hold one of the campaign's places (budget and max_claims count these). */
export const SLOT_STATES: readonly ClaimState[] = ["holding", "qualified", "approved", "paid"];

/**
 * Where the account's own campaign reward stands (app/api/campaign), for
 * the account that opened through a campaign's link: setting up (not set
 * up yet), waiting (set up, but every place is taken for now or the
 * campaign is paused), staying (set up, waiting out the days), qualified
 * (approved included, not paid yet) or paid. Never anything about a buy,
 * and nothing about anyone else's account.
 */
export type CampaignProgress = {
  amountUsd: number;
  stayDays: number;
  status: "setting_up" | "waiting" | "staying" | "qualified" | "paid";
  /** ISO; when the stay is judged, once set up. */
  eligibleAt: string | null;
  /** ISO; when it was paid. */
  paidAt: string | null;
  /** ISO; while waiting, the last moment a place may still free up (the end plus the stay). */
  deadline: string | null;
};

export type CampaignResponse = { campaign: CampaignProgress | null };

/** How long the "Paid." line stays on the home. */
export const PAID_LINE_DAYS = 14;

/**
 * Which line the home shows the account that opened through a campaign's
 * link, or none: still to set up, then waiting out the days, then
 * qualified, then paid (for PAID_LINE_DAYS). A refusal or an expiry says
 * nothing on the home.
 */
export type CampaignLine =
  | { kind: "setUp"; amountUsd: number; stayDays: number }
  | { kind: "waiting"; amountUsd: number; stayDays: number; deadline: Date }
  | { kind: "staying"; amountUsd: number; eligible: Date }
  | { kind: "qualified" }
  | { kind: "paid"; amountUsd: number };

export function campaignLine(progress: CampaignProgress | null | undefined, now: Date = new Date()): CampaignLine | null {
  if (!progress) return null;
  switch (progress.status) {
    case "paid":
      return progress.paidAt && now.getTime() - new Date(progress.paidAt).getTime() <= PAID_LINE_DAYS * 86_400_000
        ? { kind: "paid", amountUsd: progress.amountUsd }
        : null;
    case "qualified":
      return { kind: "qualified" };
    case "waiting":
      return progress.deadline
        ? { kind: "waiting", amountUsd: progress.amountUsd, stayDays: progress.stayDays, deadline: new Date(progress.deadline) }
        : null;
    case "staying":
      return progress.eligibleAt ? { kind: "staying", amountUsd: progress.amountUsd, eligible: new Date(progress.eligibleAt) } : null;
    default:
      return { kind: "setUp", amountUsd: progress.amountUsd, stayDays: progress.stayDays };
  }
}

/**
 * The stay's last days that count (lib/server/campaigns/eligibility rule 5):
 * the account must open Berth signed in at least once in this many last
 * days of the stated stay. Here, client safe, so the terms say the same
 * number the rules use.
 */
export const ACTIVE_WINDOW_DAYS = 7;

/** A whole dollar amount as "$5", anything else with cents: "$5.50". */
export function campaignUsd(value: number): string {
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

/** "3 Oct": the day and the short month, in the reader's own time zone. */
export function campaignDay(date: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone }).format(date);
}

/** Why staff refused a claim, as the staff page and the CLI name them. */
export const REJECT_REASONS = ["not_active", "one_per_person", "abuse", "other"] as const;

/** What still stands between a campaign card and activation, named plainly rather than left as a disabled button. */
export type ActivationGap = "wallet" | "funding" | "reviewed";

/**
 * The confirm panel's own checks, in the order staff sees them: a payout
 * wallet first (without one there is nothing to fund-check), then the
 * funding check, then counsel review. Mirrors the activate button's own
 * disabled condition, so the hints and the button never disagree.
 */
export function activationGaps(input: { wallet: string | null; fundingChecked: boolean; reviewed: boolean }): ActivationGap[] {
  const gaps: ActivationGap[] = [];
  if (!input.wallet) gaps.push("wallet");
  else if (!input.fundingChecked) gaps.push("funding");
  if (!input.reviewed) gaps.push("reviewed");
  return gaps;
}
