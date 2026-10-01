/**
 * Reward campaigns, the client safe half (the server half is
 * lib/server/campaigns). A campaign is a link, /c/<code>, and one promise:
 * buy at least `minBuyUsd` of any stock or fund, keep it `holdDays` days,
 * and `amountUsd` in USDC is added to the account. Berth never sends the
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

export const CLAIM_STATES = [
  "attributed",
  "buying",
  "holding",
  "qualified",
  "approved",
  "paid",
  "rejected",
  "expired",
] as const;
export type ClaimState = (typeof CLAIM_STATES)[number];

/** States that hold one of the campaign's slots (budget and max_claims count these). */
export const SLOT_STATES: readonly ClaimState[] = ["holding", "qualified", "approved", "paid"];

/** What the person's home reads (app/api/campaign): their own claim, or nothing. */
export type CampaignProgress = {
  state: ClaimState;
  amountUsd: number;
  minBuyUsd: number;
  holdDays: number;
  /** ISO; set from holding on. */
  holdingSince: string | null;
  /** ISO; when the hold is judged. */
  eligibleAt: string | null;
  /** ISO; set once paid. */
  paidAt: string | null;
  /** The buy is in, and every place is taken for now: it waits in line for one to free up. */
  waitlisted?: boolean;
  /** ISO; when a rejected or expired claim closed. */
  closedAt?: string | null;
};

export type CampaignResponse = { campaign: CampaignProgress | null };

/** How long the "Paid." line, and a closed one, stays on the home. */
export const PAID_LINE_DAYS = 14;

/**
 * Which line the home shows, or none: the rules once (no email yet asks for
 * one first), the dates while holding, then qualified and paid. A rejected
 * or expired claim shows its quiet closing line; a paid one stops showing
 * after PAID_LINE_DAYS.
 */
export type CampaignLine =
  | { kind: "rules"; needsEmail: boolean; minBuyUsd: number; holdDays: number; amountUsd: number }
  | { kind: "waiting" }
  | { kind: "holding"; since: Date; eligible: Date }
  | { kind: "qualified" }
  | { kind: "paid"; amountUsd: number }
  | { kind: "closed" };

export function campaignLine(progress: CampaignProgress | null | undefined, now: Date = new Date()): CampaignLine | null {
  if (!progress) return null;
  const { state } = progress;
  if (state === "buying" && progress.waitlisted) return { kind: "waiting" };
  if (state === "attributed" || state === "buying") {
    return {
      kind: "rules",
      needsEmail: state === "attributed",
      minBuyUsd: progress.minBuyUsd,
      holdDays: progress.holdDays,
      amountUsd: progress.amountUsd,
    };
  }
  if (state === "holding") {
    if (!progress.holdingSince || !progress.eligibleAt) return null;
    return { kind: "holding", since: new Date(progress.holdingSince), eligible: new Date(progress.eligibleAt) };
  }
  if (state === "qualified" || state === "approved") return { kind: "qualified" };
  if (state === "paid") {
    const paidAt = progress.paidAt ? new Date(progress.paidAt).getTime() : now.getTime();
    if (now.getTime() - paidAt > PAID_LINE_DAYS * 86_400_000) return null;
    return { kind: "paid", amountUsd: progress.amountUsd };
  }
  if (progress.closedAt && now.getTime() - new Date(progress.closedAt).getTime() > PAID_LINE_DAYS * 86_400_000) return null;
  return { kind: "closed" };
}

/** A whole dollar amount as "$5", anything else with cents: "$5.50". */
export function campaignUsd(value: number): string {
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

/** "3 Oct": the day and the short month, in the reader's own time zone. */
export function campaignDay(date: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone }).format(date);
}

/** Why a claim was refused, as the staff page and the CLI name it. */
export const REJECT_REASONS = ["not_held", "one_per_person", "wallet_used", "abuse", "other"] as const;
