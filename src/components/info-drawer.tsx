"use client";

import { useState } from "react";
import {
  ArrowSquareOut,
  ArrowsLeftRight,
  Info,
  Receipt,
  Scroll,
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
 * Header info button + drawer: what Berth is, what an order actually gets
 * you, and what it costs, plus a short note on how the app was built.
 */
export function InfoDrawer() {
  const [open, setOpen] = useState(false);
  const copy = useCopy();

  const sections = [
    { icon: ArrowsLeftRight, title: copy.infoHowTitle, body: copy.infoHowBody },
    { icon: Scroll, title: copy.infoOwnTitle, body: copy.infoOwnBody },
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
            {sections.map(({ icon: SectionIcon, title, body }) => (
              <div key={title} className="flex gap-3">
                <SectionIcon className="mt-0.5 size-6 shrink-0 text-primary" />
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold text-foreground">
                    {title}
                  </span>
                  <span className="text-sm text-muted-foreground">{body}</span>
                </div>
              </div>
            ))}

            <div className="flex gap-3">
              <Receipt className="mt-0.5 size-6 shrink-0 text-primary" />
              <p className="text-sm text-muted-foreground">
                {copy.infoFees(FEE_PCT)}
              </p>
            </div>

            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold text-foreground">
                {copy.infoBuiltTitle}
              </span>
              <span className="text-sm text-muted-foreground">
                {copy.infoBuiltBody}
              </span>
            </div>

            <div className="flex flex-col gap-2">
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
