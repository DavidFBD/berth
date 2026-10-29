"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { StaffEmailsView } from "@/components/staff/emails-page";
import { defaultWords } from "@/lib/new-listings-draft";
import type { StaffAnnouncement, StaffEmailsPreview, StaffEmailsState, StaffRecipient, StaffStock } from "@/lib/staff-emails-types";

/**
 * The gallery's client half (page.dev.tsx renders the real email on the
 * server and hands it in): invented data, no request leaves the page and
 * the buttons do nothing.
 */

const RECIPIENTS: StaffRecipient[] = [
  { key: "k1", label: "marta", masked: "m***@gmail.com", why: "Filled an order", excluded: false },
  { key: "k2", label: null, masked: "j***@e****.org", why: "Filled an order", excluded: false },
  { key: "k3", label: "dev", masked: "d***@e****.com", why: "Turned it on", excluded: false },
  { key: "k4", label: "ruud", masked: "r***@e****.net", why: "Filled an order", excluded: true },
];

const progress = (sent: number, waiting: number, notSent: number, notReached: number | null): StaffAnnouncement["progress"] => ({
  sent,
  waiting,
  notSent: { count: notSent, reasons: notSent > 0 ? { pref_off: notSent } : {} },
  notReached,
});

export function Gallery({ stocks, preview }: { stocks: StaffStock[]; preview: StaffEmailsPreview }) {
  const announcement = (status: StaffAnnouncement["status"], over: Partial<StaffAnnouncement> = {}): StaffAnnouncement => ({
    id: "00000000-0000-4000-8000-000000000001",
    status,
    words: defaultWords(stocks.length),
    stocks: stocks.map((stock) => ({ ...stock, ticked: true })),
    createdAt: "2026-11-02T09:00:00Z",
    queuedAt: status === "draft" ? null : "2026-11-02T09:30:00Z",
    finishedAt: null,
    progress: progress(0, 0, 0, null),
    ...over,
  });
  const history: StaffAnnouncement[] = [
    announcement("done", { id: "00000000-0000-4000-8000-000000000000", queuedAt: "2026-10-12T09:30:00Z", progress: progress(148, 0, 2, 3) }),
  ];
  const base = { switchOn: true, production: true, baselineRecorded: true };
  const states: Record<string, StaffEmailsState> = {
    nothing: { ...base, detected: [], today: { cap: 22, used: 0 }, lastQueuedAt: "2026-10-12T09:30:00Z", recentlyQueued: false, current: null, history },
    draft: {
      ...base,
      detected: stocks,
      today: { cap: 22, used: 0 },
      lastQueuedAt: "2026-10-30T09:30:00Z",
      recentlyQueued: true,
      current: { ...announcement("draft"), recipients: RECIPIENTS, sendCount: RECIPIENTS.filter((row) => !row.excluded).length, recipientTotal: RECIPIENTS.length, hash: "demo" },
      history,
    },
    sending: {
      ...base,
      detected: [],
      today: { cap: 22, used: 22 },
      lastQueuedAt: "2026-11-02T09:30:00Z",
      recentlyQueued: true,
      current: { ...announcement("sending", { progress: progress(44, 104, 1, null) }), recipients: [], sendCount: 148, recipientTotal: 148, hash: "demo" },
      history,
    },
    "no-baseline": { ...base, baselineRecorded: false, detected: [], today: { cap: 22, used: 0 }, lastQueuedAt: null, recentlyQueued: false, current: null, history: [] },
    "not-production": { ...base, production: false, detected: stocks, today: { cap: 22, used: 0 }, lastQueuedAt: null, recentlyQueued: false, current: null, history: [] },
  };
  return (
    <Suspense fallback={null}>
      <Picked states={states} preview={preview} />
    </Suspense>
  );
}

function Picked({ states, preview }: { states: Record<string, StaffEmailsState>; preview: StaffEmailsPreview }) {
  const params = useSearchParams();
  const state = states[params.get("state") ?? "draft"] ?? states.draft;
  return (
    <div className="mx-auto w-full max-w-[1240px] px-4 py-8 lg:px-8">
      <StaffEmailsView state={state} act={async () => null} loadPreview={async () => preview} />
    </div>
  );
}
