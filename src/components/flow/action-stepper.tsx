"use client";

import { Check } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { shortenAddress } from "@/lib/format";
import { PourScene, TeapotArt } from "@/components/tea/tea-art";
import { CANCELLED_MESSAGE } from "@/lib/error-copy";
import type { ReportState } from "@/lib/error-report";
import type { FillPhase } from "@/lib/pour-lifecycle";
import type { VaultActionStep } from "@/hooks/use-vault-action";
import { useCopy } from "@/components/settings-provider";
import type { Copy } from "@/lib/copy";

/* Step keys are the machine's; every label and message speaks the mode's
   voice via useCopy. Failure copy shown here is presentation only — the
   REPORTED message stays mode-blind in error-copy.ts so fingerprints keep
   grouping one bug as one issue. */
const STEP_KEYS = ["building", "approving", "signing"] as const;
type StepKey = (typeof STEP_KEYS)[number];

const STEP_LABEL: Record<StepKey, (copy: Copy) => string> = {
  building: (copy) => copy.stepBuild,
  approving: (copy) => copy.stepApprove,
  signing: (copy) => copy.stepSign,
};

const STEP_MESSAGE: Record<StepKey, (copy: Copy) => string> = {
  building: (copy) => copy.stepMsgBuilding,
  approving: (copy) => copy.stepMsgApproving,
  signing: (copy) => copy.stepMsgSigning,
};

/**
 * The brewing stepper (design system BrewStepper): Build → Approve → Sign.
 * `approveNeeded={false}` (pour-backs, native tokens) keeps the Approve dot
 * visible but marks it as skipped.
 */
export function ActionStepper({
  step,
  approveNeeded = true,
  className,
}: {
  step: VaultActionStep;
  approveNeeded?: boolean;
  className?: string;
}) {
  const copy = useCopy();
  const activeIndex = STEP_KEYS.findIndex((key) => key === step);
  if (activeIndex === -1) return null;

  return (
    <div className={cn("flex flex-col gap-5 px-2 py-4", className)}>
      <p className="text-center font-display text-lg text-foreground">
        {copy.brewing}
      </p>
      <div className="flex items-center">
        {STEP_KEYS.map((key, index) => {
          const skipped = key === "approving" && !approveNeeded;
          const done = index < activeIndex || (skipped && index <= activeIndex);
          const active = index === activeIndex && !skipped;
          return (
            <div key={key} className={cn("flex items-center", index > 0 && "flex-1")}>
              {index > 0 && (
                <div
                  className={cn(
                    "mx-1.5 h-0.5 flex-1 rounded-full transition-colors",
                    index <= activeIndex ? "bg-accent" : "bg-border",
                  )}
                  style={{
                    transitionDuration: "200ms",
                    transitionTimingFunction: "var(--ease-lift)",
                  }}
                />
              )}
              <div className="flex flex-col items-center gap-1.5">
                <div
                  className={cn(
                    "relative grid size-7.5 place-items-center rounded-full border-2 text-[13px] font-bold transition-[color,background-color,border-color] duration-200 ease-lift",
                    done && !skipped &&
                      "border-accent bg-accent text-accent-foreground",
                    active && "border-accent bg-card text-accent",
                    skipped && "border-dashed border-border text-muted-foreground",
                    !done && !active && !skipped &&
                      "border-border bg-muted text-muted-foreground",
                  )}
                >
                  {done && !skipped ? <Check className="size-4" /> : index + 1}
                  {active && (
                    <span
                      data-step-ring
                      className="absolute inset-0 rounded-full border-2 border-accent opacity-40"
                      style={{
                        animation: "ring-breathe 1.8s var(--ease-tea) infinite",
                      }}
                    />
                  )}
                </div>
                <span
                  className={cn(
                    "text-[11.5px]",
                    active
                      ? "font-bold text-foreground"
                      : "font-medium text-muted-foreground",
                  )}
                >
                  {STEP_LABEL[key](copy)}
                  {skipped && (
                    <span className="block text-center text-[9px] leading-tight text-muted-foreground/70">
                      {copy.stepSkipped}
                    </span>
                  )}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex flex-col items-center gap-1 text-center">
        <p className="text-sm font-medium text-foreground">
          {STEP_MESSAGE[STEP_KEYS[activeIndex]](copy)}
        </p>
        <p className="text-xs text-muted-foreground">{copy.keepThisOpen}</p>
      </div>
    </div>
  );
}

/**
 * The steeping tracker (design system SteepingTracker) — shown while the
 * cross-chain fill completes. The pour machine owns the status poll and hands
 * over its phase; solver status codes never reach this component.
 */
export function IntentTracking({
  phase,
  fillTxHash,
  successTitle,
  successBody,
  onDone,
  accent = "var(--cup-breakfast)",
  deep = "var(--cup-breakfast-deep)",
  className,
  reportState = "idle",
}: {
  phase: FillPhase;
  fillTxHash?: string;
  successTitle: string;
  successBody: string;
  onDone: () => void;
  accent?: string;
  deep?: string;
  className?: string;
  /** Reporting state for a failed fill, so the screen can say the team has it. */
  reportState?: ReportState;
}) {
  const copy = useCopy();
  if (phase === "filled") {
    return (
      <div className={cn("flex flex-col items-center gap-3 px-3 py-4 text-center", className)}>
        {/* The pot rights itself, the cup is full, the bloom fires. */}
        <PourScene accent={accent} deep={deep} done />
        <div className="flex flex-col gap-1">
          <p className="font-display text-lg text-foreground">{successTitle}</p>
          <p className="text-sm text-muted-foreground">{successBody}</p>
          {fillTxHash && (
            <p className="money text-xs text-muted-foreground">
              Fill tx {shortenAddress(fillTxHash)}
            </p>
          )}
        </div>
        <Button className="h-12 w-full text-base" onClick={onDone}>
          {copy.lovely}
        </Button>
      </div>
    );
  }

  if (phase === "failed") {
    return (
      <div className={cn("flex flex-col items-center gap-3 px-3 py-4 text-center", className)}>
        <div className="flex flex-col items-center">
          <div style={{ height: 40 }} />
          <TeapotArt size={64} />
        </div>
        <div className="flex flex-col gap-1">
          <p className="font-display text-lg text-destructive">
            {copy.kettleActingUpTitle}
          </p>
          <p className="text-sm text-muted-foreground">
            {copy.fillFailedScreenBody}
          </p>
          {reportState === "filed" && (
            <p className="text-xs text-muted-foreground opacity-75">
              {copy.kitchenTold}
            </p>
          )}
        </div>
        <Button variant="outline" className="h-12 w-full text-base" onClick={onDone}>
          {copy.closeLabel}
        </Button>
      </div>
    );
  }

  const filling = phase === "filling";
  return (
    <div className={cn("flex flex-col items-center gap-3 px-3 py-6 text-center", className)}>
      {/* The wait IS the pour: the longest-held frame in the app finally
          shows the app's central verb instead of a scanning bar. */}
      <PourScene accent={accent} deep={deep} />
      <div className="flex flex-col gap-1">
        <p className="font-display text-lg text-foreground">
          {copy.teaSteeping}
        </p>
        <p className="text-xs text-muted-foreground">
          {filling ? copy.goodTeaMinute : copy.carryingTray}
        </p>
      </div>
    </div>
  );
}

/**
 * The failure message, plus a quiet note when the failure has already been
 * handed to the team. A cancelled pour is styled gently and never reported:
 * the user chose it, so there is nothing to look into. The message itself
 * comes from error-copy.ts and stays mode-blind on purpose (fingerprinting);
 * only the report-status note speaks the mode.
 */
export function ActionError({
  message,
  reportState,
}: {
  message: string;
  reportState: ReportState;
}) {
  const copy = useCopy();
  const cancelled = message === CANCELLED_MESSAGE;
  return (
    <div
      role="alert"
      className={cn(
        "rounded-xl px-3 py-2.5 text-sm",
        cancelled
          ? "bg-muted/50 text-muted-foreground"
          : "bg-destructive/10 text-destructive",
      )}
    >
      <p>{message}</p>
      {!cancelled && reportState !== "idle" && (
        <p className="mt-1.5 text-[12px] opacity-75">
          {reportState === "sending"
            ? copy.lettingKitchenKnow
            : reportState === "filed"
              ? copy.kitchenToldNoReport
              : null}
        </p>
      )}
    </div>
  );
}
