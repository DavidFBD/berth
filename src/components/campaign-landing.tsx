"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { BerthMark } from "@/components/berth-mark";
import { useCopy } from "@/components/settings-provider";
import { pocketCampaignCode } from "@/lib/campaign-pocket";

/**
 * The human half of a /c/<code> landing, the invite landing's twin: pocket
 * the code and step through to the front door, saying the offer once on the
 * way, exactly as the campaign states it.
 */
export function CampaignLanding({
  code,
  minBuy,
  holdDays,
  amount,
}: {
  code: string;
  minBuy: string;
  holdDays: number;
  amount: string;
}) {
  const router = useRouter();
  const copy = useCopy();
  const landed = useRef(false);

  useEffect(() => {
    if (landed.current) return;
    landed.current = true;
    pocketCampaignCode(code);
    router.replace("/");
  }, [code, router]);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <BerthMark className="size-14" title="Berth" />
      <p className="text-lg font-semibold text-foreground">{copy.campaign.landingTitle}</p>
      <p className="max-w-80 text-sm leading-relaxed text-muted-foreground">
        {copy.campaign.landingLede(minBuy, holdDays, amount)}
      </p>
    </div>
  );
}
