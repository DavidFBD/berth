"use client";

import { CompanyMark } from "@/components/company-marks";
import { useCopy } from "@/components/settings-provider";
import { heldMarks } from "@/lib/held-marks";
import { LISTING_MARK_BY_SYMBOL, TOKEN_LISTINGS, rowName } from "@/lib/listings";
import { cn } from "@/lib/utils";

function nameOf(symbol: string): string {
  const listing = TOKEN_LISTINGS.find((entry) => entry.symbol === symbol);
  return listing ? rowName(listing) : symbol;
}

/**
 * Attached to the legend's "Your portfolio" (inline after the label on wide screens, on its own line under it on a phone, set by the caller's className): small monochrome marks of what it
 * holds (lib/held-marks), the company's own mark where one is pinned and
 * the lettered tile otherwise, then "+N". Read aloud as the names. Still,
 * never a button, and never an amount.
 */
export function HeldMarks({ held, className }: { held: readonly string[] | undefined; className?: string }) {
  const copy = useCopy();
  const { shown, more } = heldMarks(held);
  if (shown.length === 0) return null;
  return (
    <span
      role="img"
      aria-label={copy.portfolioHolds(shown.map(nameOf), more)}
      // Blocked, not masked: a company mark is path data a replay could read back as a holding.
      data-ph-block
      data-held-marks
      className={cn("inline-flex items-center gap-1 text-secondary-foreground", className)}
    >
      {shown.map((symbol) => {
        const mark = LISTING_MARK_BY_SYMBOL[symbol];
        return mark ? (
          <CompanyMark key={symbol} id={mark} className="size-3.5" />
        ) : (
          <span
            key={symbol}
            aria-hidden="true"
            className="money rounded-[4px] bg-muted px-1 text-[8.5px] leading-[14px] font-medium tracking-tight"
          >
            {symbol.slice(0, 4)}
          </span>
        );
      })}
      {more > 0 && (
        <span aria-hidden="true" className="money pl-0.5 text-[11px] leading-4 text-muted-foreground tabular-nums">
          {copy.portfolioHoldsMore(more)}
        </span>
      )}
    </span>
  );
}
