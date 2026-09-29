"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useMounted } from "@/hooks/use-mounted";
import { isOpen, nextOpen, opensAt } from "@/lib/market-calendar";

/**
 * The clock the market line reads. Null is the real clock; a dev gallery
 * sets a fixed instant so a weekend can be reviewed on a Tuesday.
 */
export const MarketClockContext = createContext<Date | null>(null);

/** Checked once a minute: the bell moves no faster than that. */
const TICK_MS = 60_000;

/**
 * When the US market is shut: the next open in the viewer's zone. Null while
 * it is open, and on the server and the hydration render, because the answer
 * depends on the viewer's clock and zone.
 */
export function useMarketClosed(): { day: string; time: string } | null {
  const frozen = useContext(MarketClockContext);
  const mounted = useMounted();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (frozen) return;
    const timer = setInterval(() => setTick((value) => value + 1), TICK_MS);
    return () => clearInterval(timer);
  }, [frozen]);
  if (!mounted) return null;
  void tick;
  const now = frozen ?? new Date();
  if (isOpen(now)) return null;
  const { timeZone, hourCycle } = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
  }).resolvedOptions();
  const hour12 = hourCycle === "h11" || hourCycle === "h12";
  return opensAt(nextOpen(now), now, timeZone, hour12);
}
