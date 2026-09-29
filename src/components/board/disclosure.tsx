"use client";

import { useId } from "react";
import { CaretDown } from "@phosphor-icons/react";
import { useCopy } from "@/components/settings-provider";
import { useStoredChoice } from "@/hooks/use-stored-choice";
import { cn } from "@/lib/utils";

/**
 * Whether one of the board's "All" disclosures is open. Remembered per
 * viewer in this browser only (useStoredChoice wraps storage that throws);
 * the server never hears of it.
 */
export function useDisclosure(name: string): [boolean, () => void, string] {
  const [stored, store] = useStoredChoice(`berth.board.open.${name}`);
  const open = stored === "1";
  const id = useId();
  return [open, () => store(open ? "0" : "1"), id];
}

/**
 * The ruled row at the foot of a section that opens the rest of it: "All 5
 * holdings" closed, "Fewer" open. The caret turns; the row is the button.
 */
export function DisclosureRow({
  open,
  onToggle,
  controls,
  label,
  className,
}: {
  open: boolean;
  onToggle: () => void;
  /** The id of the list it opens. */
  controls: string;
  /** What it says while closed. */
  label: string;
  className?: string;
}) {
  const copy = useCopy();
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
      className={cn(
        "flex min-h-12 w-full items-center justify-between gap-3 border-t border-border px-[18px] py-3 text-left text-[13.5px] text-secondary-foreground lg:px-6 outline-none transition-colors duration-150 ease-lift hover:bg-muted/60 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset",
        className,
      )}
    >
      <span>{open ? copy.disclosureFewer : label}</span>
      <CaretDown
        weight="duotone"
        aria-hidden
        className={cn("size-3.5 text-muted-foreground transition-transform duration-200 ease-lift", open && "rotate-180")}
      />
    </button>
  );
}
