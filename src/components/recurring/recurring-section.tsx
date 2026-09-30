"use client";

import { toast } from "sonner";
import { useCopy } from "@/components/settings-provider";
import { RecurringSectionView } from "@/components/recurring/recurring-section-view";
import { openPlanSheet } from "@/components/recurring/plan-sheet-events";
import { RECURRING_UNAVAILABLE, RecurringError, useRecurring, useRecurringAction } from "@/hooks/use-recurring";
import { useAvailability } from "@/components/availability/availability-context";

/**
 * The account drawer's Recurring section: each plan with its amount, its
 * day and its next date (or Paused), its last runs, and Pause, Edit and
 * Delete; and Add. Adding or editing hands over to the plan sheet, closing
 * this drawer first (drawers do not stack).
 */
export { RecurringSectionView };

export function RecurringSection({ onLeave }: { onLeave: () => void }) {
  const copy = useCopy().recurring;
  const recurring = useRecurring();
  const action = useRecurringAction();
  // Where Berth is not available a paused plan is not resumed (the route
  // refuses it); pausing and removing always work.
  const mayResume = useAvailability().available;
  return (
    <RecurringSectionView
      plans={recurring.plans}
      busy={action.isPending}
      mayResume={mayResume}
      onAdd={() => {
        onLeave();
        openPlanSheet({});
      }}
      onEdit={(plan) => {
        onLeave();
        openPlanSheet({
          planId: plan.id,
          symbol: plan.symbol,
          usd: plan.usd,
          cadence: plan.cadence,
          day: plan.cadence === "weekly" ? (plan.weekday ?? 1) : (plan.monthDay ?? 1),
          ...(plan.dipPct !== null && { dipPct: plan.dipPct }),
        });
      }}
      onPause={(plan) =>
        action.mutate(
          { action: plan.paused ? "resume" : "pause", planId: plan.id },
          {
            onError: (error) => {
              // Refused where Berth is not available: the landing, in the plan sheet's place.
              if (error instanceof RecurringError && error.reason === RECURRING_UNAVAILABLE) {
                onLeave();
                openPlanSheet({});
                return;
              }
              toast(error instanceof RecurringError && error.reason === "too_many" ? copy.resumeTooMany : copy.errors.failed);
            },
          },
        )
      }
      onDelete={(plan) => action.mutate({ action: "delete", planId: plan.id }, { onSuccess: () => toast(copy.removed) })}
    />
  );
}
