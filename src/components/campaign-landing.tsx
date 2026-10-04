"use client";

import { campaignRef, trackOnce } from "@/lib/analytics";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { BerthMark } from "@/components/berth-mark";
import { useCopy } from "@/components/settings-provider";
import { pocketCampaignCode } from "@/lib/campaign-pocket";

/**
 * The human half of a /c/<code> landing: pocket the code and step through
 * to the front door, saying the invite offer once on the way, exactly as
 * the campaign states it. The offer is for the one who invites; nobody is
 * asked to buy anything.
 */
export function CampaignLanding({
  code,
  amount,
  stayDays,
  perInviter,
}: {
  code: string;
  amount: string;
  stayDays: number;
  perInviter: number;
}) {
  const router = useRouter();
  const copy = useCopy();
  const landed = useRef(false);

  useEffect(() => {
    if (landed.current) return;
    landed.current = true;
    pocketCampaignCode(code);
    // Sent only where analytics was already allowed (lib/analytics): a first visit sends nothing,
    // and the campaign goes as a reference, never its code.
    trackOnce("campaign-landed", "campaign_landed", { campaign: campaignRef(code) });
    router.replace("/");
  }, [code, router]);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <BerthMark className="size-14" title="Berth" />
      <p className="text-lg font-semibold text-foreground">{copy.campaign.landingTitle}</p>
      <p className="max-w-80 text-sm leading-relaxed text-muted-foreground">
        {copy.campaign.landingLede(amount, stayDays, perInviter)}
      </p>
    </div>
  );
}
