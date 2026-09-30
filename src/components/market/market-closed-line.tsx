"use client";

import { useCopy } from "@/components/settings-provider";
import { useMarketClosed } from "@/hooks/use-market-closed";
import { cn } from "@/lib/utils";

/**
 * One quiet fact while the US market is shut: when it opens, in the
 * viewer's own time. No accent, no glyph, nothing at all while it is open.
 */
export function MarketClosedLine({ className }: { className?: string }) {
  const copy = useCopy();
  const closed = useMarketClosed();
  if (!closed) return null;
  return (
    <p className={cn("text-xs text-muted-foreground", className)}>
      {closed.overnight
        ? copy.marketClosedLine(closed.day, closed.time)
        : copy.marketShutLine(closed.day, closed.time)}
    </p>
  );
}
