"use client";

import { useId, type ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { Question } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

const ROW =
  "flex min-h-14 w-full items-center gap-3 rounded-xl px-2 py-2 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * One row of the pay-with picker. A row whose chain cannot pay its own
 * network fee (lib/gas-need) is still shown, so nobody wonders where their
 * money went, but it does not pick: it is a disabled button (aria-disabled,
 * so it stays focusable and announced as unavailable, with the reason as
 * its description), greyed, and the whole row opens the explanation, on
 * hover where there is a pointer and on tap where there is not. Every row
 * is at least 56px tall, past the 44px tap target.
 */
export function PayTokenRow({
  logo,
  title,
  subtitle,
  trailing,
  gasTip,
  gasHelpLabel,
  onSelect,
}: {
  logo: ReactNode;
  title: string;
  subtitle: string;
  trailing?: ReactNode;
  /** Set when the chain cannot pay the fee: the row greys and explains. */
  gasTip?: string;
  /** Names the (?) glyph for the popup's heading, read with the tip. */
  gasHelpLabel: string;
  onSelect: () => void;
}) {
  const tipId = useId();
  const body = (
    <>
      {logo}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-foreground">{title}</span>
        <span className="truncate text-xs text-muted-foreground">{subtitle}</span>
      </div>
      {trailing}
    </>
  );

  if (gasTip) {
    return (
      <Popover.Root>
        <Popover.Trigger
          openOnHover
          delay={120}
          data-gas-short=""
          aria-disabled="true"
          aria-describedby={tipId}
          className={cn(ROW, "cursor-help")}
        >
          <span className="flex min-w-0 flex-1 items-center gap-3 opacity-45 grayscale">{body}</span>
          <span
            aria-hidden
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground"
          >
            <Question weight="duotone" className="size-4" />
          </span>
          <span id={tipId} className="sr-only">
            {gasTip}
          </span>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner side="bottom" align="end" sideOffset={2} collisionPadding={16} className="z-50">
            <Popover.Popup
              aria-label={gasHelpLabel}
              className="max-w-72 origin-[var(--transform-origin)] rounded-xl border border-border bg-popover px-3 py-2.5 text-xs leading-relaxed text-popover-foreground shadow-raised transition-[opacity,transform] duration-150 ease-lift data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0"
            >
              {gasTip}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    );
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        ROW,
        "transition-[transform,background-color] duration-150 ease-lift hover:bg-muted active:bg-muted active:scale-[0.99]",
      )}
    >
      {body}
    </button>
  );
}
