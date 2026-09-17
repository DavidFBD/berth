"use client";

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "board-preview";
const QUERY_PARAM = "board";
const DEFAULT_ON = process.env.NODE_ENV !== "production";

/**
 * `?board=1` switches the preview on for this browser, `?board=0` off. Runs
 * once per mount, from the subscription, and then tells React to re-read.
 */
function syncFromUrl(): void {
  try {
    const wanted = new URLSearchParams(window.location.search).get(QUERY_PARAM);
    if (wanted === "1") window.localStorage.setItem(STORAGE_KEY, "1");
    if (wanted === "0") window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage can be unavailable (private mode); the default stands.
  }
}

function subscribe(onChange: () => void): () => void {
  syncFromUrl();
  onChange();
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

function readPreview(): boolean {
  if (DEFAULT_ON) return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Whether the board (the listings that are not cups) is shown. Always in
 * development; in production only after a visit with `?board=1`, remembered
 * per browser until `?board=0`. The live shelf stays exactly as it was for
 * everyone else while the buy and sell paths are proven with real money;
 * the rebrand round decides what the board looks like for the house.
 *
 * An external-store read rather than state in an effect: the server and the
 * first client render both answer the environment's default, and the
 * browser's answer arrives through the subscription.
 */
export function useBoardPreview(): boolean {
  return useSyncExternalStore(subscribe, readPreview, () => DEFAULT_ON);
}
