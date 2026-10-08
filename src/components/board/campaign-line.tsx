"use client";

import { useEffect } from "react";
import { trackOnce } from "@/lib/analytics";
import Link from "next/link";
import { Coins, SealCheck } from "@phosphor-icons/react";
import { useCopy } from "@/components/settings-provider";
import { useCampaignProgress } from "@/hooks/use-profile";
import { campaignDay, campaignLine, campaignUsd, type CampaignLine as Line } from "@/lib/campaigns";

/**
 * The quiet campaign line on the home of an account that opened through a
 * campaign's link (lib/campaigns campaignLine): what is left to set up,
 * then the day the stay is judged, then qualified, then paid. One
 * sentence, no button, no countdown: the money is stated exactly and
 * nothing more is promised. It never mentions a buy: a campaign never asks
 * for one. Nobody else sees a campaign line.
 */
export function CampaignLine({
  enabled,
  bare = false,
  quiet = false,
  onAcceptTerms,
}: {
  enabled: boolean;
  bare?: boolean;
  quiet?: boolean;
  /** Opens the terms sheet: accepting the terms is a step of the reward (lib/server/campaigns/eligibility rule 3). */
  onAcceptTerms?: () => void;
}) {
  const progress = useCampaignProgress(enabled);
  const step = campaignLine(progress.data)?.kind ?? null;
  useEffect(() => {
    if (step) trackOnce(`campaign-step:${step}`, "campaign_step", { step });
  }, [step]);
  return <CampaignLineView line={campaignLine(progress.data)} bare={bare} quiet={quiet} onAcceptTerms={onAcceptTerms} />;
}

/**
 * The line itself, given what to say; /dev/campaigns renders it from fixtures.
 * `bare`: inside the guided path (components/first-path), as a quiet line
 * under its action rather than a strip of its own, so a campaign never
 * reads as a second next step. No Share on X here: a post made beside a
 * paid campaign's rules would be an endorsement with a reward behind it.
 * `quiet`: small and muted, with no frame, in the home's second track
 * while the guided path is on screen (lib/campaigns campaignLinePlace).
 */
export function CampaignLineView({
  line,
  bare = false,
  quiet = false,
  onAcceptTerms,
}: {
  line: Line | null;
  bare?: boolean;
  quiet?: boolean;
  onAcceptTerms?: () => void;
}) {
  const copy = useCopy().campaign;
  if (!line) return null;
  let text: string;
  switch (line.kind) {
    case "setUp":
      text = copy.setUp(campaignUsd(line.amountUsd), line.stayDays);
      break;
    case "full":
      text = copy.full(campaignUsd(line.amountUsd), line.stayDays, campaignDay(line.deadline));
      break;
    case "paused":
      text = copy.paused;
      break;
    case "waiting":
      text = copy.waiting(campaignUsd(line.amountUsd), line.stayDays, campaignDay(line.deadline));
      break;
    case "staying":
      text = copy.staying(campaignUsd(line.amountUsd), campaignDay(line.eligible));
      break;
    case "qualified":
      text = copy.qualified;
      break;
    default:
      text = copy.paid(campaignUsd(line.amountUsd));
  }
  const Icon = line.kind === "paid" || line.kind === "qualified" ? SealCheck : Coins;
  return (
    <div
      role="status"
      data-testid="campaign-line"
      data-ph-mask
      className={
        bare
          ? "flex items-center justify-center gap-2 pt-1 text-center"
          : quiet
            ? "flex items-start gap-2 px-1 pt-1"
            : "flex items-center gap-3 rounded-lg border border-border bg-card py-2.5 pr-4 pl-[18px] lg:pl-5"
      }
    >
      <Icon weight="duotone" aria-hidden className={quiet ? "mt-0.5 size-4 shrink-0 text-muted-foreground" : "size-4 shrink-0 text-muted-foreground"} />
      <span
        className={bare || quiet ? "min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground" : "min-w-0 flex-1 text-sm text-foreground"}
      >
        {text}
      </span>
      {(line.kind === "setUp" || line.kind === "full") && line.termsDue && onAcceptTerms && (
        <button
          type="button"
          onClick={onAcceptTerms}
          className="shrink-0 text-xs text-foreground underline underline-offset-4"
          data-testid="campaign-accept-terms"
        >
          {copy.acceptTerms}
        </button>
      )}
      {(line.kind === "setUp" || line.kind === "full" || line.kind === "waiting" || line.kind === "staying") && (
        <Link href="/terms#campaigns" className="shrink-0 text-xs text-muted-foreground underline-offset-4 hover:underline">
          {copy.termsLink}
        </Link>
      )}
    </div>
  );
}
