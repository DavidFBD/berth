"use client";

import { useEffect, useId, useRef } from "react";
import { createSheetHistory, type SheetHistory } from "@/lib/sheet-history";

let shared: SheetHistory | null = null;

/** One history keeper for the page, wired to the real window on first use. */
function sheetHistory(): SheetHistory {
  if (shared) return shared;
  shared = createSheetHistory(
    {
      getState: () => window.history.state,
      push: (state) => window.history.pushState(state, ""),
      go: (delta) => window.history.go(delta),
    },
    (fn, ms) => {
      window.setTimeout(fn, ms);
    },
  );
  const keeper = shared;
  window.addEventListener("popstate", () => keeper.popstate());
  return keeper;
}

/**
 * Lets the back button, the iOS edge swipe and the Android back gesture close
 * a sheet instead of leaving the page. `close` is the sheet's own close, so a
 * sheet that refuses (a signature in flight) is asked once and, if it stays
 * open, keeps its history entry and the page stays. The rules live in
 * lib/sheet-history.
 */
export function useBackToClose(open: boolean, close: () => void, enabled = true) {
  const id = useId();
  const closeRef = useRef(close);
  const openRef = useRef(open);
  useEffect(() => {
    closeRef.current = close;
    openRef.current = open;
  });

  useEffect(() => {
    if (!open || !enabled) return;
    const keeper = sheetHistory();
    keeper.open(
      id,
      () => closeRef.current(),
      () => openRef.current,
    );
    return () => keeper.release(id);
  }, [open, enabled, id]);
}
