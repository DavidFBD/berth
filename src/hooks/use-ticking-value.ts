"use client";

import { useEffect, useRef, useState } from "react";

const YEAR_SECONDS = 365 * 24 * 60 * 60;

/** 5 ticks a second — smooth enough to read as alive, cheap enough to ignore. */
const TICK_MS = 200;

/**
 * Grows `base` at `perYear` between chain reads, so a yield figure visibly
 * moves instead of sitting still for a minute at a time.
 *
 * The clock restarts whenever a fresh `base` arrives, and the read it replaces
 * covers the same elapsed span it was interpolating — so the handover is a wash
 * rather than a visible jump. A vault genuinely losing value will tick
 * downwards, which is the honest thing for it to do.
 *
 * The ticked value is tagged with the base it grew from, so a new base falls
 * straight back to the truth instead of briefly showing the old one's drift.
 */
export function useTickingValue(
  base: number | undefined,
  perYear: number,
  active = true,
): number | undefined {
  const [ticked, setTicked] = useState<{ base: number; value: number }>();
  const anchor = useRef<{ base: number; at: number }>(undefined);

  useEffect(() => {
    if (!active || base === undefined || perYear === 0) {
      anchor.current = undefined;
      return;
    }

    anchor.current = { base, at: Date.now() };
    const id = window.setInterval(() => {
      const from = anchor.current;
      if (!from) return;
      const seconds = (Date.now() - from.at) / 1000;
      setTicked({
        base: from.base,
        value: from.base + (perYear / YEAR_SECONDS) * seconds,
      });
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [active, base, perYear]);

  if (base === undefined) return undefined;
  return ticked?.base === base ? ticked.value : base;
}
