"use client";

import Link from "next/link";
import { Coins, SealCheck } from "@phosphor-icons/react";
import { useCopy } from "@/components/settings-provider";
import { useCampaignProgress } from "@/hooks/use-profile";
import { campaignDay, campaignLine, campaignUsd, type CampaignLine as Line } from "@/lib/campaigns";

/**
 * The quiet progress line for an account that arrived through a campaign
 * link (lib/campaigns campaignLine), and for nobody else: the rules once,
 * then the dates while the buy is held, then qualified, then paid. One
 * sentence, no button, no countdown: the money is stated exactly and
 * nothing more is promised.
 */
export function CampaignLine({ enabled, bare = false }: { enabled: boolean; bare?: boolean }) {
  const progress = useCampaignProgress(enabled);
  return <CampaignLineView line={campaignLine(progress.data)} bare={bare} />;
}

/** The line itself, given what to say; /dev/campaigns renders it from fixtures. */
/**
 * `bare`: inside the guided path's money or buy step (components/first-path),
 * as a quiet line under its action rather than a strip of its own, so a
 * campaign never reads as a second next step.
 */
export function CampaignLineView({ line, bare = false }: { line: Line | null; bare?: boolean }) {
  const copy = useCopy().campaign;
  if (!line) return null;
  let text: string;
  switch (line.kind) {
    case "rules": {
      const words = line.needsEmail ? copy.rulesNeedsEmail : copy.rules;
      text = words(campaignUsd(line.minBuyUsd), line.holdDays, campaignUsd(line.amountUsd));
      break;
    }
    case "holding":
      text = copy.holding(campaignDay(line.since), campaignDay(line.eligible));
      break;
    case "waiting":
      text = copy.waiting;
      break;
    case "qualified":
      text = copy.qualified;
      break;
    case "paid":
      text = copy.paid(campaignUsd(line.amountUsd));
      break;
    default:
      text = copy.closed;
  }
  const Icon = line.kind === "paid" || line.kind === "qualified" ? SealCheck : Coins;
  return (
    <div
      role="status"
      data-testid="campaign-line"
      className={
        bare
          ? "flex items-center justify-center gap-2 pt-1 text-center"
          : "flex items-center gap-3 rounded-lg border border-border bg-card py-2.5 pr-4 pl-[18px] lg:pl-5"
      }
    >
      <Icon weight="duotone" aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <span className={bare ? "min-w-0 text-xs text-muted-foreground" : "min-w-0 flex-1 text-sm text-foreground"}>{text}</span>
      {line.kind === "rules" && (
        <Link href="/terms#campaigns" className="shrink-0 text-xs text-muted-foreground underline-offset-4 hover:underline">
          {copy.termsLink}
        </Link>
      )}
    </div>
  );
}
