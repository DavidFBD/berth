/**
 * Reward campaigns, the client safe half (the server half is
 * lib/server/campaigns). Since 5 October 2026 a campaign rewards an invite
 * that sticks, never a buy: invite a friend new to Berth, and when they
 * open an account inside the campaign's dates, set it up and still use
 * Berth `stayDays` days later, `amountUsd` in USDC is added to the
 * inviter's account, for up to `perInviter` friends, while places last.
 * Nothing asks for a buy, a holding or a volume. Berth never sends the
 * money itself: David pays each approved claim by hand.
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

/** Which rules a campaign runs. 'buy' is retired: its rows stay, read only. */
export type CampaignKind = "buy" | "invite";

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
 * What the inviter's home reads (app/api/campaign): the live invite
 * campaign's rules, and how their own invited friends are getting on.
 * Never anything about a buy.
 */
export type CampaignProgress = {
  amountUsd: number;
  stayDays: number;
  perInviter: number;
  /** An invite campaign is live now: its rules may be said. */
  open: boolean;
  /** Friends invited inside a campaign, not set up yet. */
  invited: number;
  /** Friends set up, waiting out the days. */
  staying: number;
  /** ISO; the first day one of the staying friends may qualify. */
  nextEligibleAt: string | null;
  /** Qualified or approved, not yet paid. */
  qualified: number;
  /** USD paid to this inviter in the last PAID_LINE_DAYS, and when last. */
  paidUsd: number;
  paidAt: string | null;
};

export type CampaignResponse = { campaign: CampaignProgress | null };

/** How long the "Paid." line stays on the home. */
export const PAID_LINE_DAYS = 14;

/**
 * Which line the inviter's home shows, or none: a recent payment first,
 * then a friend who qualified, then one waiting out the days, then one
 * invited and not set up yet, and otherwise, while a campaign is live, its
 * rules. A refusal says nothing on the home.
 */
export type CampaignLine =
  | { kind: "rules"; amountUsd: number; stayDays: number; perInviter: number }
  | { kind: "invited"; amountUsd: number; stayDays: number }
  | { kind: "staying"; amountUsd: number; eligible: Date }
  | { kind: "qualified" }
  | { kind: "paid"; amountUsd: number };

export function campaignLine(progress: CampaignProgress | null | undefined, now: Date = new Date()): CampaignLine | null {
  if (!progress) return null;
  if (progress.paidUsd > 0 && progress.paidAt && now.getTime() - new Date(progress.paidAt).getTime() <= PAID_LINE_DAYS * 86_400_000) {
    return { kind: "paid", amountUsd: progress.paidUsd };
  }
  if (progress.qualified > 0) return { kind: "qualified" };
  if (progress.staying > 0 && progress.nextEligibleAt) {
    return { kind: "staying", amountUsd: progress.amountUsd, eligible: new Date(progress.nextEligibleAt) };
  }
  if (progress.invited > 0) return { kind: "invited", amountUsd: progress.amountUsd, stayDays: progress.stayDays };
  if (progress.open) return { kind: "rules", amountUsd: progress.amountUsd, stayDays: progress.stayDays, perInviter: progress.perInviter };
  return null;
}

/** A whole dollar amount as "$5", anything else with cents: "$5.50". */
export function campaignUsd(value: number): string {
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

/** "3 Oct": the day and the short month, in the reader's own time zone. */
export function campaignDay(date: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone }).format(date);
}

/** Why staff refused a claim, as the staff page and the CLI name them. */
export const REJECT_REASONS = ["not_active", "self_invite", "one_per_person", "abuse", "other"] as const;
