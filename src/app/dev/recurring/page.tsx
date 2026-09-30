"use client";

import { NotHereDrawer, useAvailability } from "@/components/availability/availability";
import { DevAvailability } from "@/components/availability/dev-availability";
import { Suspense, useState } from "react";
import { notFound, useSearchParams } from "next/navigation";
import { Panel } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { RecurringSectionView } from "@/components/recurring/recurring-section";
import { RecurringStripView } from "@/components/recurring/recurring-strip";
import { PlanSheetView, draftFromRequest, type PlanDraftState } from "@/components/recurring/plan-sheet";
import { PlanDraftCard } from "@/components/chat/chat-parts";
import type { PlanView, ReadyRun } from "@/lib/recurring";

/**
 * Dev-only recurring buys gallery (lib/recurring): the strip, the account
 * drawer's section and the Assistant's plan card from fixtures, and the
 * plan sheet, without a session. Nothing here saves. Not linked anywhere;
 * 404 in prod.
 *
 *   /dev/recurring              the strip, the section, the card
 *   /dev/recurring?sheet=1      the plan sheet open, filled in
 *   /dev/recurring?sheet=dip    the same with Buy on the dip, as a switched on account sees it
 *   /dev/recurring?empty=1      the section with no plans
 *   /dev/recurring?sheet=1&country=US  the sheet where Berth is not available
 */
export default function RecurringGalleryPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <Suspense fallback={<Skeleton className="h-40 w-full" />}>
      <DevAvailability>
        <Gallery />
      </DevAvailability>
    </Suspense>
  );
}

const PLANS: PlanView[] = [
  {
    id: "p1",
    symbol: "SPY",
    usd: 20,
    cadence: "weekly",
    weekday: 1,
    monthDay: null,
    timeZone: "Europe/Amsterdam",
    orderType: "market",
    dipPct: null,
    paused: false,
    nextDueAt: "2026-10-04T22:00:00.000Z",
    createdVia: "app",
    runs: [
      { id: "r2", planId: "p1", dueAt: "2026-09-27T22:00:00.000Z", status: "placed", limitPrice: null },
      { id: "r1", planId: "p1", dueAt: "2026-09-20T22:00:00.000Z", status: "skipped", limitPrice: null },
    ],
  },
  {
    id: "p2",
    symbol: "NVDA",
    usd: 50,
    cadence: "monthly",
    weekday: null,
    monthDay: 15,
    timeZone: "Europe/Amsterdam",
    orderType: "limit",
    dipPct: 5,
    paused: true,
    nextDueAt: "2026-10-14T22:00:00.000Z",
    createdVia: "assistant",
    runs: [],
  },
];

const READY: ReadyRun = {
  id: "r3",
  planId: "p1",
  dueAt: "2026-10-04T22:00:00.000Z",
  status: "due",
  limitPrice: null,
  symbol: "SPY",
  usd: 20,
  cadence: "weekly",
  timeZone: "Europe/Amsterdam",
  orderType: "market",
};

function Gallery() {
  const params = useSearchParams();
  const sheet = params.get("sheet");
  // As PlanSheetHost does where Berth is not available (?country=US).
  const availability = useAvailability();
  const [open, setOpen] = useState(sheet !== null);
  const [state, setState] = useState<PlanDraftState>(() =>
    draftFromRequest(sheet === "dip" ? { symbol: "NVDA", usd: 50, cadence: "monthly", day: 15, dipPct: 5 } : { symbol: "SPY", usd: 20, cadence: "weekly", day: 1 }),
  );
  // ?unpriced=1: a dip plan's run with no price today. ?signedout=1: the sheet offers sign in.
  const [run, setRun] = useState<ReadyRun | null>(params.get("unpriced") === "1" ? { ...READY, orderType: "limit" } : READY);
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 py-6">
      <RecurringStripView run={run} weekday={1} onOpen={() => setOpen(true)} onSkip={() => setRun(null)} />
      <Panel>
        <RecurringSectionView
          plans={params.get("empty") === "1" ? [] : PLANS}
          onAdd={() => setOpen(true)}
          onEdit={() => setOpen(true)}
          onPause={() => {}}
          onDelete={() => {}}
        />
      </Panel>
      <PlanDraftCard plan={{ symbol: "SPY", name: "S&P 500 ETF", usd: 20, cadence: "weekly", day: 1 }} onOpen={() => setOpen(true)} />
      {!availability.available ? (
        <NotHereDrawer availability={availability} open={open} onOpenChange={setOpen} />
      ) : (
      <PlanSheetView
        open={open}
        onOpenChange={setOpen}
        state={state}
        onChange={(patch) => setState((current) => ({ ...current, ...patch }))}
        limitAllowed={sheet === "dip"}
        problem={null}
        saving={false}
        onSave={() => setOpen(false)}
        signIn={params.get("signedout") === "1" ? () => setOpen(false) : undefined}
      />
      )}
    </div>
  );
}
