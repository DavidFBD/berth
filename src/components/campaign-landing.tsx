"use client";

import { campaignRef, trackOnce } from "@/lib/analytics";
import { useEffect, useRef, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BerthMark } from "@/components/berth-mark";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/components/settings-provider";
import { pocketCampaignCode } from "@/lib/campaign-pocket";
import { campaignUsd, landingEnds, type CampaignLanding as Landing } from "@/lib/campaigns";

const noSubscribe = () => () => {};

/**
 * The human half of a /c/<code> landing: a calm page that stays up. A live
 * offer states the amount, the short rules and a link to the full ones,
 * and pockets the code on arrival (lib/campaign-pocket), exactly as the
 * old step-through did, so the account opened in this browser carries it.
 * Start goes on to sign up. A full, ended, paused or unknown offer says so
 * plainly, pockets nothing and promises nothing, and Start still goes on.
 * The offer is for the one who opens a new account through this link;
 * nobody is asked to buy anything.
 */
export function CampaignLanding({ landing }: { landing: Landing }) {
  const router = useRouter();
  const copy = useCopy().campaign.landing;
  const landed = useRef(false);
  const live = landing.state === "live" ? landing : null;
  const none = landing.state === "live" ? null : copy[landing.state];

  useEffect(() => {
    if (landed.current || !live) return;
    landed.current = true;
    pocketCampaignCode(live.code);
    // Sent only where analytics was already allowed (lib/analytics): a first visit sends nothing,
    // and the campaign goes as a reference, never its code.
    trackOnce("campaign-landed", "campaign_landed", { campaign: campaignRef(live.code) });
  }, [live]);

  const start = () => router.push("/");
  // The end in the reader's own time zone, once in the browser; the server's first paint says it in UTC.
  const inBrowser = useSyncExternalStore(noSubscribe, () => true, () => false);
  const ends = live ? landingEnds(new Date(live.endsAt), inBrowser ? undefined : "UTC") : null;
  const endsText = ends ? (ends.time ? copy.endsAt(ends.day, ends.time) : ends.day) : "";

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-5 px-4 py-10 text-center">
      <BerthMark className="size-12" title="Berth" />
      {live ? (
        <>
          <div className="flex flex-col gap-2">
            <h1 className="font-heading text-2xl tracking-tight text-foreground">{copy.title}</h1>
            <p className="text-[15px] leading-relaxed text-foreground" data-testid="campaign-offer">
              {copy.offer(campaignUsd(live.amountUsd))}
            </p>
          </div>
          <section className="w-full rounded-lg border border-border bg-card px-5 py-4 text-left">
            <h2 className="text-sm text-muted-foreground">{copy.rulesHeading}</h2>
            <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed text-foreground marker:text-muted-foreground">
              {copy.rules(live.stayDays, endsText).map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
            <Link
              href="/terms#campaigns"
              className="mt-3 inline-block text-sm text-foreground underline underline-offset-4"
              data-testid="campaign-full-rules"
            >
              {copy.fullRules}
            </Link>
          </section>
          <p className="max-w-80 text-xs leading-relaxed text-muted-foreground">{copy.sameBrowser}</p>
        </>
      ) : (
        <div className="flex flex-col gap-2" data-testid={`campaign-${landing.state}`}>
          <h1 className="font-heading text-2xl tracking-tight text-foreground">{none?.title}</h1>
          <p className="text-[15px] leading-relaxed text-muted-foreground">{none?.body}</p>
        </div>
      )}
      <Button size="lg" className="w-full max-w-80" onClick={start} data-testid="campaign-start">
        {copy.start}
      </Button>
    </main>
  );
}
