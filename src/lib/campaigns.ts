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
 * up yet), full (not set up yet, and every place is taken for now), waiting (set up, but every place is taken for now), paused (the
 * campaign is paused before a place was taken), staying (set up, waiting out the days), qualified
 * (approved included, not paid yet) or paid. Never anything about a buy,
 * and nothing about anyone else's account.
 */
export type CampaignProgress = {
  amountUsd: number;
  stayDays: number;
  status: "setting_up" | "full" | "waiting" | "paused" | "staying" | "qualified" | "paid";
  /** ISO; when the stay is judged, once set up. */
  eligibleAt: string | null;
  /** ISO; when it was paid. */
  paidAt: string | null;
  /** ISO; while full or waiting, the last moment a place may still free up (the end plus the stay). */
  deadline: string | null;
  /** While setting up or full: the current terms are not accepted yet, a condition of payment (the line's "Accept the terms"). */
  termsDue?: boolean;
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
  | { kind: "setUp"; amountUsd: number; stayDays: number; termsDue: boolean }
  | { kind: "full"; amountUsd: number; stayDays: number; deadline: Date; termsDue: boolean }
  | { kind: "waiting"; amountUsd: number; stayDays: number; deadline: Date }
  | { kind: "paused" }
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
    case "paused":
      return { kind: "paused" };
    case "full":
      return progress.deadline
        ? {
            kind: "full",
            amountUsd: progress.amountUsd,
            stayDays: progress.stayDays,
            deadline: new Date(progress.deadline),
            termsDue: progress.termsDue === true,
          }
        : null;
    case "waiting":
      return progress.deadline
        ? { kind: "waiting", amountUsd: progress.amountUsd, stayDays: progress.stayDays, deadline: new Date(progress.deadline) }
        : null;
    case "staying":
      return progress.eligibleAt ? { kind: "staying", amountUsd: progress.amountUsd, eligible: new Date(progress.eligibleAt) } : null;
    default:
      return { kind: "setUp", amountUsd: progress.amountUsd, stayDays: progress.stayDays, termsDue: progress.termsDue === true };
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
 * funding check, then the staff member's own reading of the campaign, its
 * rules and the terms. Mirrors the activate button's own
 * disabled condition, so the hints and the button never disagree.
 */
export function activationGaps(input: { wallet: string | null; fundingChecked: boolean; reviewed: boolean }): ActivationGap[] {
  const gaps: ActivationGap[] = [];
  if (!input.wallet) gaps.push("wallet");
  else if (!input.fundingChecked) gaps.push("funding");
  if (!input.reviewed) gaps.push("reviewed");
  return gaps;
}

/**
 * What the /c/<code> landing says (app/c/[code], components/campaign-landing):
 * `live` states the offer and pockets the code; every other state says
 * plainly why there is no offer here and still lets the person sign up,
 * with nothing promised and nothing pocketed. A campaign never activated
 * is no campaign at all, so a draft's code says nothing of it.
 */
export type CampaignLanding =
  | { state: "live"; code: string; amountUsd: number; stayDays: number; endsAt: string }
  | { state: "full" | "ended" | "paused" | "unknown" };

export type LandingCampaign = {
  code: string;
  kind: CampaignKind;
  amountUsd: number;
  budgetUsd: number;
  maxClaims: number;
  stayDays: number;
  active: boolean;
  activatedAt: Date | null;
  startsAt: Date;
  endsAt: Date;
  /** Claims holding a place (SLOT_STATES). */
  taken: number;
};

/** A campaign's shareable link, always on production's own origin: the one staff hand out. */
export function campaignLinkUrl(code: string): string {
  return `https://www.berthmarkets.com/c/${encodeURIComponent(code)}`;
}

/** /c/<code> with the request's query carried over as it came, repeated keys included. Pure. */
export function campaignPath(code: string, query: Record<string, string | string[] | undefined> = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    for (const one of Array.isArray(value) ? value : value === undefined ? [] : [value]) search.append(key, one);
  }
  const rest = search.toString();
  return `/c/${encodeURIComponent(code)}${rest ? `?${rest}` : ""}`;
}

/**
 * "11 Oct at 00:00 CEST": a moment in the reader's own time zone (or the
 * one given), its zone named for that very date. Pure.
 */
export function localDateTime(iso: string, timeZone?: string): string {
  // Built from parts, so every engine writes it the same way (Safari says "at", Node a comma).
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
    timeZone,
  }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? "";
  const zone = part("timeZoneName");
  return `${part("day")} ${part("month")} at ${part("hour")}:${part("minute")}${zone ? ` ${zone}` : ""}`;
}

/** Places still free: the fewer of the places left and the rewards the budget still covers. Pure. */
export function placesLeft(campaign: Pick<LandingCampaign, "amountUsd" | "budgetUsd" | "maxClaims" | "taken">): number {
  if (!(campaign.amountUsd > 0)) return 0;
  const byBudget = Math.floor((campaign.budgetUsd - campaign.taken * campaign.amountUsd) / campaign.amountUsd + 1e-9);
  return Math.max(0, Math.min(campaign.maxClaims - campaign.taken, byBudget));
}

/** The landing's state for a campaign row (or none) at `now`. Pure. */
export function landingState(campaign: LandingCampaign | null | undefined, now: Date = new Date()): CampaignLanding {
  if (!campaign) return { state: "unknown" };
  if (campaign.kind !== "signup") return { state: "ended" };
  if (!campaign.active && campaign.activatedAt === null) return { state: "unknown" };
  if (now.getTime() > campaign.endsAt.getTime()) return { state: "ended" };
  if (now.getTime() < campaign.startsAt.getTime()) return { state: "unknown" };
  if (!campaign.active) return { state: "paused" };
  // Every place taken (or the budget spent): the link stops promising.
  if (placesLeft(campaign) <= 0) return { state: "full" };
  return {
    state: "live",
    code: campaign.code,
    amountUsd: campaign.amountUsd,
    stayDays: campaign.stayDays,
    endsAt: campaign.endsAt.toISOString(),
  };
}

/** A landing state from a fixture, for `next dev` previews only (app/c/[code]): null unless `preview` names a state. */
export function landingPreview(code: string, preview: string | null): CampaignLanding | null {
  if (preview === "live") {
    return { state: "live", code: normalizeCampaignCode(code) ?? "preview", amountUsd: 5, stayDays: 14, endsAt: "2026-11-01T00:00:00.000Z" };
  }
  if (preview === "full" || preview === "ended" || preview === "paused" || preview === "unknown") return { state: preview };
  return null;
}

/**
 * Where the home shows the campaign line (components/home), or nowhere yet.
 * While the guided first path is on screen (or still being read) the line
 * shows from the start, but quietly in the second track, after the
 * board, the news and your AI: never inside the path's cards and never
 * beside its Buy, since a reward never stands next to a buy. Once the path
 * is done or skipped, it is the last of the strips, as before, and only
 * once the step and the holdings are settled so it never pushes anything
 * down. Pure.
 */
export function campaignLinePlace({
  pathOnScreen,
  stageKnown,
  holdingsSettled,
}: {
  pathOnScreen: boolean;
  stageKnown: boolean;
  holdingsSettled: boolean;
}): "aside" | "strips" | null {
  if (pathOnScreen) return "aside";
  return stageKnown && holdingsSettled ? "strips" : null;
}

/**
 * What the queue suggests for a claim, or null. A sign up from a country
 * that could not be told (often a VPN) is suggested for rejection unless
 * staff have reason to override: only a suggestion, never an automatic
 * reject, and only while the claim still waits on a decision. Pure.
 */
export function suggestedAction(claim: { state: ClaimState; signals: readonly string[] }): "reject" | null {
  if (claim.state !== "holding" && claim.state !== "qualified") return null;
  return claim.signals.includes("unknown_country") ? "reject" : null;
}

/**
 * The landing's end: the day alone when the campaign ends at midnight UTC
 * (the last whole day, in UTC), else the day and the time in `timeZone`
 * (the reader's own, on the page), since a sign up after that minute does
 * not count. Pure.
 */
export function landingEnds(endsAt: Date, timeZone?: string): { day: string; time: string | null } {
  const midnight = endsAt.getUTCHours() === 0 && endsAt.getUTCMinutes() === 0 && endsAt.getUTCSeconds() === 0 && endsAt.getUTCMilliseconds() === 0;
  if (midnight) return { day: campaignDay(new Date(endsAt.getTime() - 1), "UTC"), time: null };
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(endsAt);
  return { day: campaignDay(endsAt, timeZone), time };
}
