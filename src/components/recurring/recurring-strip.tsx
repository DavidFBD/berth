"use client";

import { AnimatePresence, motion } from "motion/react";
import { toast } from "@/lib/toast";
import { ArrowsClockwise } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/components/settings-provider";
import { useRecurring, useRecurringAction } from "@/hooks/use-recurring";
import type { BuyPrefill } from "@/lib/draft-open";
import { formatUsd } from "@/lib/format";
import { TOKEN_LISTINGS, type TokenListing } from "@/lib/listings";
import { dipExpiry, dueDayWords, type ReadyRun } from "@/lib/recurring";
import { EASE_LIFT } from "@/lib/motion";

/**
 * Under the account total, only on a plan's day: "Your Monday S&P 500 ETF
 * buy of $20.00 is ready." Open it fills the buy drawer (and the run reads
 * as opened); Skip lets it pass, which costs nothing. It goes once the run
 * is signed, skipped, or three days old. One run at a time, the oldest.
 */
export function RecurringStrip({ onOpen }: { onOpen: (listing: TokenListing, prefill: BuyPrefill) => void }) {
  const copy = useCopy().recurring;
  const recurring = useRecurring();
  const action = useRecurringAction();
  const run = recurring.ready[0];
  const plan = run ? recurring.plans.find((candidate) => candidate.id === run.planId) : undefined;
  return (
    <RecurringStripView
      run={run ?? null}
      weekday={plan?.weekday ?? null}
      busy={action.isPending}
      onOpen={(ready) => {
        const listing = TOKEN_LISTINGS.find((candidate) => candidate.symbol === ready.symbol);
        if (!listing) return;
        action.mutate({ action: "open", runId: ready.id });
        const expires =
          ready.limitPrice !== null && plan
            ? dipExpiry({ cadence: plan.cadence, weekday: plan.weekday, monthDay: plan.monthDay, timeZone: plan.timeZone }, Date.parse(ready.dueAt))
            : undefined;
        onOpen(listing, {
          usd: ready.usd,
          ...(ready.limitPrice !== null && { limit: { price: ready.limitPrice, ...(expires && { expires }) } }),
        });
      }}
      onSkip={(ready) =>
        action.mutate(
          { action: "skip", runId: ready.id },
          { onSuccess: () => plan && toast(copy.skipped(dueDayWords(plan.nextDueAt, plan.timeZone))) },
        )
      }
    />
  );
}

/** Whether the strip is showing, for the one-strip-at-a-time rule (lib/email-nudge). */
export function useRecurringStripShowing(): boolean {
  return useRecurring().ready.length > 0;
}

export function RecurringStripView({
  run,
  weekday,
  busy = false,
  onOpen,
  onSkip,
}: {
  run: ReadyRun | null;
  weekday: number | null;
  busy?: boolean;
  onOpen: (run: ReadyRun) => void;
  onSkip: (run: ReadyRun) => void;
}) {
  const copy = useCopy().recurring;
  const name = run ? (TOKEN_LISTINGS.find((listing) => listing.symbol === run.symbol)?.name ?? run.symbol) : "";
  const lead = run?.cadence === "weekly" ? copy.weekdays[weekday ?? 1] : copy.monthlyLead;
  return (
    <AnimatePresence initial={false}>
      {run ? (
        <motion.div
          data-ph-mask
          key={run.id}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.24, ease: EASE_LIFT }}
          role="status"
          data-testid="recurring-strip"
          className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-border bg-card py-2.5 pr-2.5 pl-[18px] lg:pl-5"
        >
          <ArrowsClockwise weight="duotone" aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 text-sm text-foreground">
            {copy.strip(lead, name, formatUsd(run.usd))}
            {run.limitPrice !== null && <span className="text-muted-foreground"> {copy.stripLimit(formatUsd(run.limitPrice))}</span>}
            {run.limitPrice === null && run.orderType === "limit" && <span className="text-muted-foreground"> {copy.stripUnpriced}</span>}
          </span>
          <span className="flex shrink-0 gap-1">
            <Button size="xs" disabled={busy} onClick={() => onOpen(run)}>
              {copy.stripOpen}
            </Button>
            <Button size="xs" variant="ghost" className="text-muted-foreground" disabled={busy} onClick={() => onSkip(run)}>
              {copy.stripSkip}
            </Button>
          </span>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
