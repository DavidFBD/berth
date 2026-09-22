"use client";

import type { ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { Info } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

/**
 * A small (i) that holds the sentence a heading used to carry underneath it.
 *
 * A popover rather than a tooltip, on purpose: a tooltip is hover-only, and
 * every iOS visitor has no hover. This opens on hover where there is a
 * pointer and on tap where there is not, closes on Escape or a tap outside,
 * and is a real button with a name, so a screen reader reaches the text too.
 */
export function InfoTip({
  label,
  children,
  className,
}: {
  /** The button's accessible name: what the (i) is about. */
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger
        openOnHover
        delay={120}
        aria-label={label}
        className={cn(
          "inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 ease-lift outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 data-[popup-open]:text-foreground",
          className,
        )}
      >
        <Info weight="duotone" className="size-4" aria-hidden />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={6} collisionPadding={16} className="z-50">
          <Popover.Popup className="max-w-72 origin-[var(--transform-origin)] rounded-xl border border-border bg-popover px-3 py-2.5 text-xs leading-relaxed text-popover-foreground shadow-raised transition-[opacity,transform] duration-150 ease-lift data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0">
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
