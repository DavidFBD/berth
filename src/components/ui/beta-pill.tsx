"use client";

import { Popover } from "@base-ui/react/popover";
import { cn } from "@/lib/utils";
import { useCopy } from "@/components/settings-provider";
import { BERTH_BETA } from "@/lib/beta";

/**
 * The quiet "Beta" pill beside the wordmark: ink/muted with a hairline
 * border, never the accent. Built on the same Popover primitive as
 * InfoTip (ui/info-tip.tsx), so it opens on hover where there's a pointer
 * and on tap where there isn't, closes on Escape or a tap outside, and is
 * a real labelled button a screen reader reaches too.
 *
 * BERTH_BETA (lib/beta.ts) is the one switch: false hides this everywhere
 * it's rendered, with nothing else to change.
 */
export function BetaPill({ className }: { className?: string }) {
  const copy = useCopy();
  if (!BERTH_BETA) return null;

  return (
    <Popover.Root>
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
            <a
              href={copy.beta.contactHref}
              className="mt-1.5 inline-block font-medium text-foreground underline underline-offset-2 hover:text-muted-foreground"
            >
              {copy.beta.contactLabel}
            </a>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
