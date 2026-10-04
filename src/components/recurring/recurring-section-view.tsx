"use client";

import { useState } from "react";
import { ArrowsClockwise, Plus } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { useCopy } from "@/components/settings-provider";
import { formatUsd } from "@/lib/format";
import { TOKEN_LISTINGS } from "@/lib/listings";
import { MAX_PLANS, dueDayWords, ordinal, type PlanView } from "@/lib/recurring";

/** The section itself, given the plans; /dev/account renders it without an account. */
export function RecurringSectionView({
  plans,
  busy = false,
  mayResume = true,
  onAdd,
  onEdit,
  onPause,
  onDelete,
}: {
  plans: readonly PlanView[];
  busy?: boolean;
  /** false where Berth is not available: a paused plan offers no Resume. */
  mayResume?: boolean;
  onAdd: () => void;
  onEdit: (plan: PlanView) => void;
  onPause: (plan: PlanView) => void;
  onDelete: (plan: PlanView) => void;
}) {
  const copy = useCopy().recurring;
  return (
    <section className="flex flex-col" aria-label={copy.sectionLabel} data-testid="recurring-section" data-ph-mask>
      <div className="flex items-center gap-1 px-3 pt-3 pb-1">
        <span className="text-sm font-medium text-foreground">{copy.sectionLabel}</span>
        <InfoTip label={copy.sectionLabel}>
          <p>{copy.nothingUntil}</p>
        </InfoTip>
      </div>
      {plans.length === 0 ? (
        <p className="px-3 pb-1 text-xs text-muted-foreground">{copy.empty}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {plans.map((plan) => (
            <PlanRow key={plan.id} plan={plan} busy={busy} mayResume={mayResume} onEdit={() => onEdit(plan)} onPause={() => onPause(plan)} onDelete={() => onDelete(plan)} />
          ))}
        </ul>
      )}
      {plans.length < MAX_PLANS && (
        <button
          type="button"
          onClick={onAdd}
          className="flex min-h-12 w-full items-center gap-3 px-3 py-2.5 text-left transition-[background-color] duration-150 ease-lift hover:bg-muted/60 active:bg-muted"
        >
          <Plus weight="duotone" className="size-4 text-muted-foreground" aria-hidden />
          <span className="text-sm text-foreground">{copy.add}</span>
        </button>
      )}
    </section>
  );
}

function PlanRow({
  plan,
  busy,
  mayResume,
  onEdit,
  onPause,
  onDelete,
}: {
  plan: PlanView;
  busy: boolean;
  mayResume: boolean;
  onEdit: () => void;
  onPause: () => void;
  onDelete: () => void;
}) {
  const copy = useCopy().recurring;
  const [confirming, setConfirming] = useState(false);
  const name = TOKEN_LISTINGS.find((listing) => listing.symbol === plan.symbol)?.name ?? plan.symbol;
  const when = plan.cadence === "weekly" ? copy.whenWeekly(copy.weekdays[plan.weekday ?? 1]) : copy.whenMonthly(ordinal(plan.monthDay ?? 1));
  const runs = plan.runs
    .filter((run) => run.status === "placed" || run.status === "skipped")
    .slice(0, 3)
    .map((run) => `${copy.runWords[run.status]} ${dueDayWords(run.dueAt, plan.timeZone)}`);
  return (
    <li className="flex flex-col gap-1.5 px-3 py-2.5" data-testid="recurring-plan">
      <div className="flex items-start gap-3">
        <ArrowsClockwise weight="duotone" className="mt-0.5 size-[18px] shrink-0 text-muted-foreground" aria-hidden />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm text-foreground">{name}</span>
          <span className="text-xs text-secondary-foreground tabular-nums">
            {copy.row(formatUsd(plan.usd), when)}
            {plan.orderType === "limit" && plan.dipPct !== null ? `. ${copy.asDip(`${plan.dipPct}%`)}` : ""}
          </span>
          <span className="text-xs text-muted-foreground">
            {plan.paused ? copy.paused : copy.next(dueDayWords(plan.nextDueAt, plan.timeZone))}
            {runs.length > 0 ? `. ${copy.lastRuns(runs.join(", "))}` : ""}
          </span>
        </span>
      </div>
      {confirming ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-[30px]" role="group" aria-label={copy.removeConfirm}>
          <span className="text-xs text-foreground">{copy.removeConfirm}</span>
          <Button
            size="xs"
            variant="destructive"
            disabled={busy}
            onClick={() => {
              setConfirming(false);
              onDelete();
            }}
          >
            {copy.removeConfirmYes}
          </Button>
          <Button size="xs" variant="ghost" className="text-muted-foreground" onClick={() => setConfirming(false)}>
            {copy.removeConfirmNo}
          </Button>
        </div>
      ) : (
        <div className="flex gap-1 pl-[30px]">
          {(mayResume || !plan.paused) && (
            <Button size="xs" variant="ghost" className="text-muted-foreground" disabled={busy} onClick={onPause}>
              {plan.paused ? copy.resume : copy.pause}
            </Button>
          )}
          <Button size="xs" variant="ghost" className="text-muted-foreground" disabled={busy} onClick={onEdit}>
            {copy.edit}
          </Button>
          <Button size="xs" variant="ghost" className="text-muted-foreground" disabled={busy} onClick={() => setConfirming(true)}>
            {copy.remove}
          </Button>
        </div>
      )}
    </li>
  );
}
