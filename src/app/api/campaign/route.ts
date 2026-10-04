import { NextResponse, type NextRequest } from "next/server";
import { readRewardsCaller, resolveRewardsUser } from "@/lib/server/rewards-route";
import { campaignProgress } from "@/lib/server/campaigns/eligibility";
import { AVAILABLE } from "@/lib/server/availability";
import type { CampaignResponse } from "@/lib/campaigns";

/**
 * The caller's invite campaign line, as an inviter (lib/campaigns
 * campaignLine): the live campaign's rules and how the friends they invited
 * are getting on, their open claims advanced on the way (database only;
 * the stay is judged by the morning run). `{ campaign: null }` when no
 * invite campaign is live and nobody they invited holds a claim, for
 * anyone asking from where Berth is not available, and while the tables
 * are not there.
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
    // Unknown is not "no campaign": a share post must keep its reward disclosure (components/share-on-x).
    return NextResponse.json({ error: "campaign_unavailable" }, { status: 503 });
  }
  return NextResponse.json({ campaign } satisfies CampaignResponse);
}
