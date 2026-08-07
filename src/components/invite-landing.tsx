"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { pocketReferralCode } from "@/lib/referral";
import { SteamPlume } from "@/components/tea/tea-art";

/* eslint-disable @next/next/no-img-element -- tiny local brand mark */

/**
 * The human half of an /r/CODE landing: pocket the code, beacon the tap for
 * the referrer's funnel numbers, and step through to the front door. Shows
 * the same quiet steam as the auth splash — no flash of a bare page.
 */
export function InviteLanding({ code }: { code: string }) {
  const router = useRouter();
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
    <div className="flex min-h-dvh flex-col items-center justify-center gap-2">
      <SteamPlume level={1} width={54} height={30} />
      <img src="/lsteatime-mark.svg" alt="" aria-hidden width={56} height={56} />
    </div>
  );
}
