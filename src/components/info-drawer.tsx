"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowSquareOut,
  CaretRight,
  Info,
  Robot,
  Sparkle,
  Wrench,
} from "@phosphor-icons/react";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/components/settings-provider";
import { FEE_PCT_LABEL as FEE_PCT } from "@/lib/sodax-config";

/**
 * Header info button + drawer: the story of how this app was vibed together,
 * retold in whichever voice the active mode speaks. Same facts in every
 * telling — switching modes and rereading it is the easter egg.
 */
export function InfoDrawer() {
  const [open, setOpen] = useState(false);
  const copy = useCopy();

  const stats = [
    { icon: Robot, stat: copy.infoAgentsStat, detail: copy.infoAgentsDetail },
    { icon: Wrench, stat: copy.infoMcpStat, detail: copy.infoMcpDetail },
    { icon: Sparkle, stat: copy.infoTimeStat, detail: copy.infoTimeDetail },
  ];

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="About this app"
        className="shrink-0"
        onClick={() => setOpen(true)}
      >
        <Info className="size-5" />
      </Button>

      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{copy.infoTitle}</DrawerTitle>
            <DrawerDescription>{copy.infoSub}</DrawerDescription>
          </DrawerHeader>

          <div className="flex flex-col gap-4 p-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
            {stats.map(({ icon: StatIcon, stat, detail }) => (
              <div key={stat} className="flex gap-3">
                <StatIcon className="mt-0.5 size-6 shrink-0 text-primary" />
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold text-foreground">
                    {stat}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {detail}
                  </span>
                </div>
              </div>
            ))}

            <p className="text-sm text-muted-foreground">
              <span className="text-foreground">@sodax/dapp-kit</span>{" "}
              {copy.infoPorcelain}
            </p>

            <p className="text-xs text-muted-foreground">
              {copy.infoHouseRules(FEE_PCT)}
            </p>

            <div className="flex flex-col gap-2">
              <Link
                href="/lore"
                className="flex items-center justify-between rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                {copy.loreLink}
                <CaretRight className="size-4 text-muted-foreground" />
              </Link>
              <a
                href="https://builders.sodax.com"
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                {copy.infoBuildersCta}
                <ArrowSquareOut className="size-4 text-muted-foreground" />
              </a>
              <a
                href="https://docs.sodax.com"
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                {copy.infoDocsCta}
                <ArrowSquareOut className="size-4 text-muted-foreground" />
              </a>
            </div>
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}
