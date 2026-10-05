import { NextResponse, type NextRequest } from "next/server";
import { readRewardsCaller, resolveRewardsUser } from "@/lib/server/rewards-route";
import { campaignProgress } from "@/lib/server/campaigns/eligibility";
import { AVAILABLE } from "@/lib/server/availability";
import type { CampaignResponse } from "@/lib/campaigns";

/**
 * The caller's own campaign reward (lib/campaigns campaignLine): where the
 * claim of an account that opened through a campaign's link stands, its
 * open claim advanced on the way (database only; the stay is judged by the
 * morning run). `{ campaign: null }` when the caller holds no open or paid
 * claim, for anyone asking from where Berth is not available, and while
 * the tables are not there.
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
    return NextResponse.json({ error: "campaign_unavailable" }, { status: 503 });
  }
  return NextResponse.json({ campaign } satisfies CampaignResponse);
}
