"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useMounted } from "@/hooks/use-mounted";
import { isOpen, lastClose, nextOpen, opensAt } from "@/lib/market-calendar";

/**
 * The clock the market line reads. Null is the real clock; a dev gallery
 * sets a fixed instant so a weekend can be reviewed on a Tuesday.
 */
export const MarketClockContext = createContext<Date | null>(null);

/** Checked once a minute: the bell moves no faster than that. */
const TICK_MS = 60_000;

/** A shut market shorter than this is a weekday night; longer is a weekend or holiday, when prices hold at the last close. */
const OVERNIGHT_MS = 24 * 60 * 60 * 1000;

/**
 * When the US market is shut: the next open in the viewer's zone, and
 * whether this is only a weekday night rather than a weekend or holiday
 * (when the price underneath holds at the last close). Null while it is open, and on
 * the server and the hydration render, because the answer depends on the
 * viewer's clock and zone.
 */
export function useMarketClosed(): { day: string; time: string; overnight: boolean } | null {
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
  const opens = nextOpen(now);
  const overnight = opens.getTime() - lastClose(now).getTime() < OVERNIGHT_MS;
  return { ...opensAt(opens, now, timeZone, hour12), overnight };
}
