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
  // A sheet that is locked (a signature is being prepared or in flight) keeps
  // the page from being left by reload, tab close or a history jump.
  window.addEventListener("beforeunload", (event) => {
    if (!keeper.anyLocked()) return;
    event.preventDefault();
    event.returnValue = "";
  });
  return keeper;
}

/**
 * Lets the back button, the iOS edge swipe and the Android back gesture close
 * a sheet instead of leaving the page. `close` is the sheet's own close, so a
 * sheet that refuses (a signature in flight) is asked once and, if it stays
 * open, keeps its history entry and the page stays. A sheet that knows it is
 * `locked` is never asked: back is held at once. The rules live in
 * lib/sheet-history.
 *
 * Rule for callers: close a sheet by a route change, or close it and leave it
 * to the route change to finish; never close the sheet and then call
 * router.push in the same handler. The close pops the sheet's history entry
 * with go(-1), and that traversal would cancel the navigation that follows.
 */
export function useBackToClose(open: boolean, close: () => void, enabled = true, locked = false) {
  const id = useId();
  const closeRef = useRef(close);
  const openRef = useRef(open);
  const lockedRef = useRef(locked);
  useEffect(() => {
    closeRef.current = close;
    openRef.current = open;
    lockedRef.current = locked;
  });

  useEffect(() => {
    if (!open || !enabled) return;
    const keeper = sheetHistory();
    keeper.open(
      id,
      () => closeRef.current(),
      () => openRef.current,
      () => lockedRef.current,
    );
    return () => keeper.release(id);
  }, [open, enabled, id]);
}
