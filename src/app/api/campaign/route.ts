import { NextResponse, type NextRequest } from "next/server";
import { readRewardsCaller, resolveRewardsUser } from "@/lib/server/rewards-route";
import { campaignProgress } from "@/lib/server/campaigns/eligibility";
import { AVAILABLE } from "@/lib/server/availability";
import type { CampaignResponse } from "@/lib/campaigns";

/**
 * The caller's own campaign claim, for the home's quiet progress line
 * (lib/campaigns campaignLine), advanced on the way (database only; the
 * hold check stays the morning run's). `{ campaign: null }` for anyone who
 * did not arrive through a campaign, for anyone asking from where Berth is
 * not available, and while the tables are not there.
 */
export async function POST(request: NextRequest) {
  const read = await readRewardsCaller(request);
  if (!read.ok) return read.response;
  const resolved = await resolveRewardsUser(read.caller);
  if (!resolved.ok) return resolved.response;
  let campaign: CampaignResponse["campaign"] = null;
  // Where Berth is not available, no campaign is offered, not even one attributed elsewhere.
  if (!(read.caller.availability ?? AVAILABLE).available) return NextResponse.json({ campaign } satisfies CampaignResponse);
  try {
    campaign = await campaignProgress(resolved.user.id);
  } catch (error) {
    console.warn("[campaigns] progress read failed", error instanceof Error ? error.message : error);
  }
  return NextResponse.json({ campaign } satisfies CampaignResponse);
}
