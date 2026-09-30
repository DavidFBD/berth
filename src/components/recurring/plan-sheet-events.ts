"use client";

import type { Cadence } from "@/lib/recurring";

/**
 * One plan sheet for the whole page (PlanSheetHost, mounted by Home), opened
 * from four places that share no parent: the account drawer's Recurring
 * section, the buy drawer's "Make this recurring", the Assistant's draft
 * card and a draft_recurring link. Drawers do not stack, so each caller
 * closes its own drawer first, then asks for the sheet here.
 */
export type PlanSheetRequest = {
  /** Editing this plan; a new one when absent. */
  planId?: string;
  symbol?: string;
  usd?: number;
  cadence?: Cadence;
  /** The weekday (0 Sunday) or the day of the month. */
  day?: number;
  dipPct?: number;
  via?: "app" | "assistant";
};

const EVENT = "berth:plan-sheet";

export function openPlanSheet(request: PlanSheetRequest = {}): void {
  if (typeof window === "undefined") return;
  // After the caller's own drawer has begun to close.
  window.setTimeout(() => window.dispatchEvent(new CustomEvent<PlanSheetRequest>(EVENT, { detail: request })), 0);
}

export function onPlanSheet(listener: (request: PlanSheetRequest) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<PlanSheetRequest>).detail ?? {});
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
