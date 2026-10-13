"use client";

import { Suspense, useEffect, useState } from "react";
import { notFound, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import { RANKS, XP_ACTIONS, isXpKind, type XpKind } from "@/lib/xp";
import { seenLevelKey } from "@/lib/level-up";
import type { Profile } from "@/lib/profile-types";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";

/**
 * Dev-only: the level-up takeover (components/level-up-takeover), fired the
 * way the app fires it, through lib/toast and the celebration queue. Not
 * linked anywhere; 404 in prod.
 *
 *   /dev/levelup                       Play reaches Berth Holder (level 3) for turning on friend features
 *   &level=7                           the rung reached (7, Pier, opens the Blue Crab face)
 *   &kind=pour_in                      the one reward that crossed it
 *   &avatar=buoy                       the face (none: the rank glyph on a disc)
 *   &auto=1                            plays on load, no button
 *   &drawer=1                          an order drawer is open: the takeover waits until it closes
 */
export default function LevelUpGalleryPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <Suspense fallback={null}>
      <Gallery />
    </Suspense>
  );
}

function Gallery() {
  const params = useSearchParams();
  const level = Math.min(Math.max(Number(params.get("level") ?? 3), 2), RANKS.length);
  const kindParam = params.get("kind") ?? "friends_all_on";
  const kind: XpKind = isXpKind(kindParam) ? kindParam : "friends_all_on";
  const avatar = params.get("avatar") ?? "buoy";
  const auto = params.get("auto") === "1";
  const [drawer, setDrawer] = useState(params.get("drawer") === "1");
  const queryClient = useQueryClient();

  const play = () => {
    const amount = XP_ACTIONS[kind].amount;
    const newXp = RANKS[level - 1].xp + Math.min(amount, 20);
    toast.rewards([{ kind, amount }], newXp);
  };

  useEffect(() => {
    // A fresh gallery celebrates again: forget the rung this device last saw.
    try {
      window.localStorage.removeItem(seenLevelKey(null) ?? "berth.level-celebrated.anonymous");
    } catch {
      // Nothing kept.
    }
    queryClient.setQueryData<Profile>(["profile", null], {
      xp: 0,
      avatarId: avatar === "none" ? null : avatar,
      hasEmail: true,
      referralCode: null,
    });
    if (auto) {
      const timer = window.setTimeout(play, 300);
      return () => window.clearTimeout(timer);
    }
    // Once, on load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col gap-4 bg-background p-4">
      <p className="text-sm text-muted-foreground">Level-up takeover gallery.</p>
      <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
        <p className="font-display text-xl text-foreground">Your holdings</p>
        <p className="text-sm text-muted-foreground">A stand-in for the home, so the scrim has something to sit over.</p>
      </div>
      <Button onClick={play}>Play</Button>
      <Drawer open={drawer} onOpenChange={setDrawer}>
        <DrawerContent data-order-drawer="">
          <DrawerHeader>
            <DrawerTitle>Buy NVIDIA</DrawerTitle>
          </DrawerHeader>
          <div className="flex flex-col gap-3 p-4">
            <Button onClick={play}>Fill the order</Button>
            <Button variant="outline" onClick={() => setDrawer(false)}>
              Close
            </Button>
          </div>
        </DrawerContent>
      </Drawer>
    </main>
  );
}
