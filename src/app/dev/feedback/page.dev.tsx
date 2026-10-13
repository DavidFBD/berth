"use client";

import { Suspense, useState } from "react";
import { notFound, useSearchParams } from "next/navigation";
import { Panel } from "@/components/ui/panel";
import { BetaPill } from "@/components/ui/beta-pill";
import { FeedbackForm, type FeedbackFixture } from "@/components/feedback/feedback-form";
import { FeedbackSheet } from "@/components/feedback/feedback-sheet";
import { OrderFeedbackLink } from "@/components/feedback/order-feedback-link";
import { FeedbackList } from "@/components/staff/feedback-list";
import { COPY } from "@/lib/copy";
import { XP_ACTIONS } from "@/lib/xp";
import type { FeedbackRow } from "@/lib/server/feedback";

/**
 * Dev-only: the feedback sheet in each of its states, from fixtures (Send
 * goes nowhere), the Beta pill that opens it, the order link, and the staff
 * list over sample rows. Not linked anywhere; 404 in prod.
 *
 *   /dev/feedback                    every state inline, and the staff list
 *   /dev/feedback?sheet=empty        the sheet itself, open, in one state:
 *                                    empty, filled, sent, sent-xp, signed-out, too-many
 *   /dev/feedback?staff=1            only the staff list
 */

const FILLED = "The sell drawer kept the old amount after I switched from NVIDIA to Apple, so I had to clear it by hand before I could type a new one.";

const STATES: Record<string, { label: string; fixture: FeedbackFixture }> = {
  empty: { label: "Empty, an account with an email", fixture: { signedIn: true, hasEmail: true } },
  filled: { label: "Written, reply allowed", fixture: { signedIn: true, hasEmail: true, text: FILLED, mayReply: true } },
  "no-email": { label: "Written, an account without an email (no reply box)", fixture: { signedIn: true, hasEmail: false, text: FILLED } },
  "sent-xp": { label: "Sent, the first message, with its XP", fixture: { signedIn: true, hasEmail: true, state: "sent", awarded: XP_ACTIONS.feedback_first.amount } },
  sent: { label: "Sent, a later message", fixture: { signedIn: true, hasEmail: true, state: "sent", awarded: 0 } },
  "too-many": { label: "Too many in an hour", fixture: { signedIn: true, hasEmail: true, text: FILLED, state: "too_many" } },
  "signed-out": { label: "Signed out", fixture: { signedIn: false, hasEmail: false } },
};

/** Fixed times, so the server and the browser render the same text. */
const SAMPLE_ROWS: FeedbackRow[] = [
  {
    id: "5f0c2a8e-1d0b-4c55-9a43-6b1f3c9d7e01",
    userId: "a1b2c3d4-0000-4000-8000-000000000001",
    username: "harbourmaster",
    body: FILLED,
    context: { path: "/", viewport: "390x844", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1", build: "4a80024" },
    mayReply: true,
    hasEmail: true,
    status: "new",
    createdAt: "2026-10-11T12:05:00.000Z",
    fixedAt: null,
    staffNote: null,
    replied: false,
  },
  {
    id: "5f0c2a8e-1d0b-4c55-9a43-6b1f3c9d7e02",
    userId: "a1b2c3d4-0000-4000-8000-000000000002",
    username: null,
    body: "It said it was checking for a long time and then nothing. Did my order go through or not?",
    context: {
      path: "/",
      viewport: "1280x800",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
      build: "4a80024",
      order: { kind: "unsettled", id: "9e8d7c6b-0000-4000-8000-0000000000aa" },
    },
    mayReply: false,
    hasEmail: false,
    status: "read",
    createdAt: "2026-10-10T09:41:00.000Z",
    fixedAt: null,
    staffNote: null,
    replied: false,
  },
  {
    id: "5f0c2a8e-1d0b-4c55-9a43-6b1f3c9d7e03",
    userId: "a1b2c3d4-0000-4000-8000-000000000003",
    username: "gosia",
    body: "Dark mode makes the chart line hard to see.",
    context: { path: "/u/:username", viewport: "390x844", userAgent: "Mozilla/5.0 (Linux; Android 16) Chrome/141.0 Mobile Safari/537.36", build: "7fec3e7" },
    mayReply: true,
    hasEmail: true,
    status: "fixed",
    createdAt: "2026-10-08T16:33:00.000Z",
    fixedAt: "2026-10-09T10:12:00.000Z",
    staffNote: "Chart line uses ink in dark mode now.",
    replied: true,
  },
];

function Gallery() {
  if (process.env.NODE_ENV === "production") notFound();
  const params = useSearchParams();
  const sheet = params.get("sheet");
  const [open, setOpen] = useState(true);

  if (sheet && STATES[sheet]) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col gap-3 px-4 py-8">
        <p className="text-xs text-muted-foreground">{STATES[sheet].label}</p>
        <FeedbackSheet open={open} onOpenChange={setOpen} fixture={STATES[sheet].fixture} />
      </div>
    );
  }

  const staffOnly = params.get("staff") === "1";
  const staff = (
    <Panel as="div" className="flex flex-col gap-2 p-4">
      <h2 className="font-display text-lg text-foreground">{COPY.staff.feedback.title}</h2>
      <FeedbackList rows={SAMPLE_ROWS} canAct demo />
    </Panel>
  );
  if (staffOnly) return <div className="mx-auto w-full max-w-[1240px] px-4 py-8">{staff}</div>;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <div className="flex items-center gap-2">
        <h1 className="font-display text-xl text-foreground">Feedback</h1>
        <BetaPill />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        {Object.entries(STATES).map(([name, { label, fixture }]) => (
          <section key={name} className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">
              {label} <span className="font-money">?sheet={name}</span>
            </p>
            <Panel as="div" className="p-4">
              <FeedbackForm fixture={fixture} onClose={() => {}} />
            </Panel>
          </section>
        ))}
        <section className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">Under a failed order</p>
          <Panel as="div" className="flex flex-col p-4">
            <OrderFeedbackLink kind="fill_failed" />
          </Panel>
        </section>
      </div>
      {staff}
    </div>
  );
}

export default function FeedbackGalleryPage() {
  return (
    <Suspense>
      <Gallery />
    </Suspense>
  );
}
