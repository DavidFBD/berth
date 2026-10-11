import { placesLeft, SLOT_STATES, type ClaimState } from "@/lib/campaigns";

/**
 * The staff campaign card's numbers at a glance (components/staff/campaigns-queue),
 * from the campaign's meter (lib/server/campaigns/queue): nothing here
 * reads anything new, it only puts the claims' states in the order a
 * person goes through them. Pure.
 *
 *   opens       the link's landing was shown (campaign_link_opens)
 *   signedUp    a new account opened through the link: every claim, whatever its state now
 *   setUp       of those, the ones that got as far as set up
 *   staying     holding a place, waiting out the days now
 *   qualified   stayed, waiting for staff to approve
 *   approved    approved, waiting to be paid by hand
 *   paid        paid
 *   placesLeft  places still free, by the places and by the budget
 *   budgetLeftUsd  the budget not yet reserved or paid
 */

export type CampaignStatsInput = {
  amountUsd: number;
  budgetUsd: number;
  maxClaims: number;
  counts: Record<ClaimState, number>;
  reservedUsd: number;
  paidUsd: number;
  opens: number;
  setUp: number;
};

export type CampaignStats = {
  opens: number;
  signedUp: number;
  setUp: number;
  staying: number;
  qualified: number;
  approved: number;
  paid: number;
  placesLeft: number;
  budgetLeftUsd: number;
};

export function campaignStats(campaign: CampaignStatsInput): CampaignStats {
  const counts = campaign.counts;
  const signedUp = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const taken = SLOT_STATES.reduce((sum, state) => sum + counts[state], 0);
  return {
    opens: campaign.opens,
    signedUp,
    setUp: campaign.setUp,
    staying: counts.holding,
    qualified: counts.qualified,
    approved: counts.approved,
    paid: counts.paid,
    placesLeft: placesLeft({ amountUsd: campaign.amountUsd, budgetUsd: campaign.budgetUsd, maxClaims: campaign.maxClaims, taken }),
    budgetLeftUsd: Math.max(0, Math.round((campaign.budgetUsd - campaign.reservedUsd - campaign.paidUsd) * 100) / 100),
  };
}

/** What waits on staff for this campaign, most urgent first: qualified to approve, approved to pay. Empty when nothing does. */
export type NeedsYou = { kind: "approve" | "pay"; count: number }[];

export function needsYou(stats: Pick<CampaignStats, "qualified" | "approved">): NeedsYou {
  const out: NeedsYou = [];
  if (stats.qualified > 0) out.push({ kind: "approve", count: stats.qualified });
  if (stats.approved > 0) out.push({ kind: "pay", count: stats.approved });
  return out;
}

/** Where a campaign stands for the card's pill. */
export type CampaignStatus = "live" | "scheduled" | "ended" | "paused" | "draft" | "retired";

/**
 * live: switched on and inside its dates. scheduled: switched on, not
 * started. ended: past its end, whatever the switch. paused: switched off
 * after it was once on. draft: never switched on. retired: made under the
 * retired buy or invite rules. Pure.
 */
export function campaignStatus(
  campaign: { kind: string; active: boolean; draft: boolean; startsAt: string; endsAt: string },
  now: Date = new Date(),
): CampaignStatus {
  if (campaign.kind !== "signup") return "retired";
  if (now.getTime() > new Date(campaign.endsAt).getTime()) return "ended";
  if (campaign.active) return now.getTime() < new Date(campaign.startsAt).getTime() ? "scheduled" : "live";
  return campaign.draft ? "draft" : "paused";
}

/**
 * The claims queue's sections, in order, for every campaign or for one
 * (a card's Review or Pay shows only its own). Pure.
 */
export function claimGroups<T extends { state: ClaimState; campaignId: string }>(claims: readonly T[], campaignId: string | null = null) {
  const shown = campaignId ? claims.filter((claim) => claim.campaignId === campaignId) : [...claims];
  return {
    qualified: shown.filter((claim) => claim.state === "qualified"),
    approved: shown.filter((claim) => claim.state === "approved"),
    holding: shown.filter((claim) => claim.state === "holding"),
    paid: shown.filter((claim) => claim.state === "paid"),
    closed: shown.filter((claim) => claim.state === "rejected" || claim.state === "expired"),
  };
}
