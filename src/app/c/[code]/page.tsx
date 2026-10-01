import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { CampaignLanding } from "@/components/campaign-landing";
import { campaignForLanding } from "@/lib/server/campaigns/store";
import { requestAvailability } from "@/lib/server/availability";
import { campaignUsd } from "@/lib/campaigns";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Berth",
  robots: { index: false, follow: false },
};

/**
 * A campaign link, /c/<code> (lib/campaigns, lib/server/campaigns). Only a
 * campaign that is active and inside its dates is pocketed; anything else,
 * and any visit from where Berth is not available, steps straight through
 * to the front door with nothing pocketed, so no promise is made that the
 * server would not keep. The code is bound later, on the new account's
 * first sync, exactly as an invite code is.
 */
type Params = { params: Promise<{ code: string }> };

export default async function CampaignPage({ params }: Params) {
  const { code } = await params;
  const requestHeaders = await headers();
  if (!requestAvailability(requestHeaders).available) redirect("/");
  const campaign = await campaignForLanding(code);
  if (!campaign) redirect("/");
  return (
    <CampaignLanding
      code={campaign.code}
      minBuy={campaignUsd(campaign.minBuyUsd)}
      holdDays={campaign.holdDays}
      amount={campaignUsd(campaign.amountUsd)}
    />
  );
}
