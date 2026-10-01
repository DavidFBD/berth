"use client";

import { Suspense, useEffect, useRef } from "react";
import { notFound, useSearchParams } from "next/navigation";
import { toast } from "@/lib/toast";
import { announceRewards } from "@/components/xp-toast";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/components/settings-provider";
import type { Copy } from "@/lib/copy";
import { AskDock } from "@/components/chat/ask-surfaces";

/**
 * Dev-only toast gallery: the moments where one action says two things at
 * once, fired the way the app fires them, so the stack can be seen. Nothing
 * here saves. Not linked anywhere; 404 in prod.
 *
 *   /dev/toasts?play=buy        a buy that fills and earns XP
 *   /dev/toasts?play=avatar     a first face that pays XP and crosses a rank
 *   /dev/toasts?play=salute     a Salute, then a friend's reward from the sync
 *   /dev/toasts?play=recurring  a recurring buy saved, the plan opened
 *   /dev/toasts?play=burst      five things at once
 *   /dev/toasts?play=all        a buy and an avatar together
 *   &dock=1                     with the phone's Ask dock at the foot
 */
export default function ToastGalleryPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <Suspense fallback={null}>
      <Gallery />
    </Suspense>
  );
}

type Scenario = "buy" | "avatar" | "salute" | "recurring" | "burst" | "all";
const SCENARIOS: Scenario[] = ["buy", "avatar", "salute", "recurring", "burst", "all"];

const later = (ms: number, run: () => void) => window.setTimeout(run, ms);

function play(scenario: Scenario, copy: Copy) {
  switch (scenario) {
    case "buy":
      toast.success(copy.buyFilledTitle, { description: copy.buyFilledBody });
      later(700, () => announceRewards([{ kind: "pour_in", amount: 100 }], 350));
      return;
    case "avatar":
      announceRewards([{ kind: "avatar_set", amount: 50 }], 130);
      return;
    case "salute":
      toast.success(copy.social.saluted);
      later(400, () => announceRewards([{ kind: "friend_poured", amount: 250 }], 1200));
      return;
    case "recurring":
      toast.success(copy.recurring.saved("Monday 6 October"));
      later(300, () => toast(copy.recurring.planOpened));
      return;
    case "burst":
      toast.success(copy.walletsLinkedToast, { description: "0x12ab…9f3e" });
      toast.success(copy.receiveCopied);
      toast(copy.social.linkCopied);
      announceRewards([{ kind: "theme_tried", amount: 25 }, { kind: "email_linked", amount: 100 }], 480);
      toast.error(copy.social.actionFailed);
      return;
    case "all":
      play("buy", copy);
      later(200, () => play("avatar", copy));
      return;
  }
}

function Gallery() {
  const copy = useCopy();
  const params = useSearchParams();
  const auto = params.get("play") as Scenario | null;
  const dock = params.get("dock") === "1";
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current || !auto || !SCENARIOS.includes(auto)) return;
    fired.current = true;
    // A beat after mount, so the Toaster is listening.
    later(400, () => play(auto, copy));
  }, [auto, copy]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-4 py-6">
      <h1 className="font-heading text-xl">Toasts</h1>
      <div className="flex flex-wrap gap-2">
        {SCENARIOS.map((scenario) => (
          <Button key={scenario} variant="outline" onClick={() => play(scenario, copy)}>
            {scenario}
          </Button>
        ))}
      </div>
      {dock && <AskDock onOpen={() => undefined} hidden={false} />}
    </main>
  );
}
