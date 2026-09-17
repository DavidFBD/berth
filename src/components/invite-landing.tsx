"use client";

import { useEffect, useRef } from "react";
import { BerthMark } from "@/components/berth-mark";
import { useRouter } from "next/navigation";
import { pocketReferralCode } from "@/lib/referral";
import { useCopy } from "@/components/settings-provider";


/**
 * The human half of an /r/CODE landing: pocket the code, beacon the tap for
 * the referrer's funnel numbers, and step through to the front door. Shows
 * the invite it was handed, so a friend's link never lands on a bare page.
 */
export function InviteLanding({ code }: { code: string }) {
  const router = useRouter();
  const copy = useCopy();
  // Strict mode replays effects in dev; one landing must count once.
  const landed = useRef(false);

  useEffect(() => {
    if (landed.current) return;
    landed.current = true;
    pocketReferralCode(code);
    void fetch("/api/referral/click", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
      keepalive: true,
    }).catch(() => {
      // Telemetry only; the invite is already in the pocket.
    });
    router.replace("/");
  }, [code, router]);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <BerthMark className="size-14" title="Berth" />
      <p className="text-lg font-semibold text-foreground">
        {copy.friendInvitedYou}
      </p>
      <p className="max-w-80 text-sm leading-relaxed text-muted-foreground">
        {copy.welcomeLede}
      </p>
    </div>
  );
}
