"use client";

import { track } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import { inviteLink } from "@/lib/referral";
import { inviteXWords, xPostIntent } from "@/lib/x-intent";
import { useCampaignProgress } from "@/hooks/use-profile";
import { useCopy } from "@/components/settings-provider";
import { XMark } from "@/components/x-mark";

/**
 * "Share on X" for the person's own invite link: X's composer opens in a
 * new tab with one calm line and the link, and the person decides whether
 * to post. Berth calls no X API and gives nothing for the tap or the post,
 * not XP, not a place, not money (X's developer policy, and Berth's own
 * rule: no reward for any X action). While an invite campaign is live, or
 * before Berth knows there is none, the words disclose that the inviter
 * may be paid for a friend who joins.
 */
export function ShareInviteOnX({ code, surface, className }: { code: string; surface: string; className?: string }) {
  const copy = useCopy();
  const campaign = useCampaignProgress(true);
  const live = campaign.data === undefined ? undefined : campaign.data !== null && campaign.data.open;
  return (
    <a
      href={xPostIntent(inviteXWords(copy, live), inviteLink(code))}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => track("invite_link_shared", { surface })}
      className={cn(
        "inline-flex min-h-9 items-center gap-1.5 text-xs font-medium text-muted-foreground underline decoration-border underline-offset-4 transition-colors hover:text-foreground hover:decoration-foreground/40",
        className,
      )}
    >
      <XMark className="size-3" />
      {copy.inviteXShare}
    </a>
  );
}
