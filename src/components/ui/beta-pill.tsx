"use client";

import { lazy, Suspense, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/components/settings-provider";
import { BERTH_BETA } from "@/lib/beta";

/**
 * The quiet "Beta" pill beside the wordmark: ink/muted with a hairline
 * border, never the accent. Built on the same Popover primitive as
 * InfoTip (ui/info-tip.tsx), so it opens on hover where there's a pointer
 * and on tap where there isn't, closes on Escape or a tap outside, and is
 * a real labelled button a screen reader reaches too.
 *
 * The popover's "Tell us what you think" opens the feedback sheet
 * (components/feedback), signed in or not: signed out, the sheet asks for
 * a sign in rather than taking words it could not keep.
 *
 * BERTH_BETA (lib/beta.ts) is the one switch: false hides this everywhere
 * it's rendered, with nothing else to change.
 */
/** Loaded on the first tap: the sheet reads the account, which the pill itself never needs. */
const FeedbackSheet = lazy(() => import("@/components/feedback/feedback-sheet").then((module) => ({ default: module.FeedbackSheet })));

export function BetaPill({ className }: { className?: string }) {
  const copy = useCopy();
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  // Kept mounted once opened, so it can animate closed.
  const [opened, setOpened] = useState(false);
  if (!BERTH_BETA) return null;

  return (
    <>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger
          openOnHover
          delay={120}
          aria-label={copy.beta.openLabel}
          className={cn(
            "inline-flex shrink-0 items-center self-center rounded-full border border-border px-1.5 py-[0.1875rem] text-[10px] font-medium uppercase leading-none tracking-wide text-muted-foreground outline-none transition-colors duration-150 ease-lift hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 data-[popup-open]:text-foreground",
            className,
          )}
        >
          {copy.beta.tag}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner side="bottom" align="start" sideOffset={6} collisionPadding={16} className="z-50">
            <Popover.Popup className="max-w-72 origin-[var(--transform-origin)] rounded-xl border border-border bg-popover px-3 py-2.5 text-xs leading-relaxed text-popover-foreground shadow-raised transition-[opacity,transform] duration-150 ease-lift data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0">
              <p>{copy.beta.body}</p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-2"
                onClick={() => {
                  setOpen(false);
                  setOpened(true);
                  setSheet(true);
                }}
              >
                {copy.feedback.betaAction}
              </Button>
              <a
                href={copy.beta.contactHref}
                className="mt-2 block font-medium text-foreground underline underline-offset-2 hover:text-muted-foreground"
              >
                {copy.beta.contactLabel}
              </a>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      {opened && (
        <Suspense fallback={null}>
          <FeedbackSheet open={sheet} onOpenChange={setSheet} />
        </Suspense>
      )}
    </>
  );
}
