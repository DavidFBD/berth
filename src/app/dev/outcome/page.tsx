"use client";

import { notFound } from "next/navigation";
import { OutcomeCheckNote } from "@/components/flow/action-stepper";
import type { OutcomeCheck } from "@/hooks/use-sponsor-refusals";

/**
 * Dev-only: the order screen's note after a sponsored send whose answer
 * did not come back clearly (lib/gas-sponsor watchOutcome), in each state
 * it can be in. Not linked anywhere; 404 in prod.
 */
export default function OutcomeCheckGallery() {
  if (process.env.NODE_ENV === "production") notFound();
  const states: { label: string; fixture: OutcomeCheck }[] = [
    { label: "Checking, hold counting down", fixture: { phase: "checking", secondsLeft: 42, waiting: false } },
    { label: "Still waiting on the wallet past its deadline", fixture: { phase: "checking", secondsLeft: 60, waiting: true } },
    { label: "Held, no chain check running", fixture: { phase: "unclear", secondsLeft: 35, waiting: false } },
    { label: "Something reached the network", fixture: { phase: "sent", secondsLeft: 30, waiting: false } },
    { label: "Hold over, nothing seen", fixture: { phase: "unclear", secondsLeft: 0, waiting: false } },
    { label: "Wallet refused a stalled send", fixture: { phase: "nothing-sent", secondsLeft: 0, waiting: false } },
  ];
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 py-8">
      <h1 className="font-display text-xl text-foreground">Unclear order answer</h1>
      {states.map(({ label, fixture }) => (
        <section key={label} className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">{label}</p>
          <OutcomeCheckNote fixture={fixture} />
        </section>
      ))}
    </div>
  );
}
