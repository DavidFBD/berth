"use client";

import type { ReactNode } from "react";
import { CaretRight, ListBullets, Newspaper, PlugsConnected, type Icon } from "@phosphor-icons/react";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Panel } from "@/components/ui/panel";
import { useCopy } from "@/components/settings-provider";

/**
 * What the home keeps one tap away rather than on the page (2026-10-01, the
 * calm home): every stock and fund, the news, and bringing Berth into your
 * own AI. Each row opens its own drawer holding the very same section the
 * page used to carry, so nothing that worked is lost, it is only quieter.
 */
export function HomeMore({
  onBoard,
  onNews,
  onAi,
}: {
  onBoard: () => void;
  onNews: () => void;
  /** Absent when the account drawer has no assistant steps to land on. */
  onAi?: () => void;
}) {
  const copy = useCopy();
  return (
    <Panel as="aside" className="divide-y divide-border overflow-hidden">
      <h2 className="sr-only">{copy.calmHome.moreLabel}</h2>
      <MoreRow glyph={ListBullets} title={copy.boardTitle} sub={copy.calmHome.moreBoardSub} onClick={onBoard} />
      <MoreRow glyph={Newspaper} title={copy.newsTitle} sub={copy.calmHome.moreNewsSub} onClick={onNews} />
      {onAi && <MoreRow glyph={PlugsConnected} title={copy.assistantTitle} sub={copy.calmHome.moreAiSub} onClick={onAi} />}
    </Panel>
  );
}

function MoreRow({ glyph: Glyph, title, sub, onClick }: { glyph: Icon; title: string; sub: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      className="flex min-h-16 w-full items-center gap-3 px-[18px] py-3.5 text-left outline-none transition-colors duration-150 ease-lift hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset lg:px-6"
    >
      <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-secondary-foreground">
        <Glyph weight="duotone" className="size-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-display text-base leading-tight text-foreground">{title}</span>
        <span className="mt-0.5 block text-[13px] leading-5 text-muted-foreground">{sub}</span>
      </span>
      <CaretRight weight="duotone" aria-hidden className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

/**
 * A drawer holding one of the page's own sections. The section carries its
 * own heading and (i), so the drawer's title is for screen readers only.
 */
export function SectionDrawer({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader className="sr-only">
          <DrawerTitle>{title}</DrawerTitle>
          <DrawerDescription>{description}</DrawerDescription>
        </DrawerHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-4 *:shrink-0 pb-[max(env(safe-area-inset-bottom),1rem)]">
          {children}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
