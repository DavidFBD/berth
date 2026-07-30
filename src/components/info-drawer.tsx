"use client";

import { useState } from "react";
import { ArrowSquareOut, Info, Robot, Sparkle, Wrench } from "@phosphor-icons/react";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";

const STATS = [
  {
    icon: Robot,
    stat: "25+ AI agents",
    detail:
      "One measured the leaves, one warmed the pot, several argued about steam. Researchers, builders, and reviewers, all orchestrated by one Claude session.",
  },
  {
    icon: Wrench,
    stat: "1 MCP server",
    detail:
      "The SODAX Builders MCP poured live protocol data (chains, tokens, vaults, docs) straight into the agents' cups while they worked.",
  },
  {
    icon: Sparkle,
    stat: "~1 afternoon",
    detail:
      "From an empty folder to a reviewed, cross-chain tea service: scaffolded, brewed, tasted adversarially, and refined. No crypto jargon survived the tasting.",
  },
];

/** Header info button + drawer: the story of how this app was vibed together. */
export function InfoDrawer() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="About this app"
        onClick={() => setOpen(true)}
      >
        <Info className="size-5" />
      </Button>

      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>How this was made</DrawerTitle>
            <DrawerDescription>
              Vibed together over many cups.
            </DrawerDescription>
          </DrawerHeader>

          <div className="flex flex-col gap-4 p-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
            {STATS.map(({ icon: StatIcon, stat, detail }) => (
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
              Under the porcelain: <span className="text-foreground">@sodax/dapp-kit</span>{" "}
              turns every pour into an intent-based cross-chain swap. Any
              asset on any of 20 networks in, leveraged staked-yield tea on
              Sonic out, one signature.
            </p>

            <div className="flex flex-col gap-2">
              <a
                href="https://builders.sodax.com"
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                See how it&apos;s brewed at SODAX Builders
                <ArrowSquareOut className="size-4 text-muted-foreground" />
              </a>
              <a
                href="https://docs.sodax.com"
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                SODAX developer docs
                <ArrowSquareOut className="size-4 text-muted-foreground" />
              </a>
            </div>
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}
