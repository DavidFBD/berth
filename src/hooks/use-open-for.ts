"use client";

import { useEffect, useState } from "react";

/**
 * True once `open` has stayed true for `ms`; false again the moment it
 * closes, so every opening waits afresh. The reset is a render-time
 * adjustment, per house pattern; only the timer lives in an effect.
 */
export function useOpenFor(open: boolean, ms: number): boolean {
  const [over, setOver] = useState(false);
  if (!open && over) setOver(false);
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => setOver(true), ms);
    return () => clearTimeout(timer);
  }, [open, ms]);
  return over;
}
