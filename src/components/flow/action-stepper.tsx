"use client";

import { Check } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { shortenAddress } from "@/lib/format";
import { hubTxUrl } from "@/lib/chains";
import { LoadingMark } from "@/components/loading-mark";
import { ThinkingOrb } from "@/components/ui/thinking-orb";
import { CANCELLED_MESSAGE } from "@/lib/error-copy";
import type { ReportState } from "@/lib/error-report";
import type { FillPhase } from "@/lib/pour-lifecycle";
import type { VaultActionStep } from "@/hooks/use-vault-action";
import { useCopy } from "@/components/settings-provider";
import type { Copy } from "@/lib/copy";
import { stepMessage } from "@/lib/step-message";

/* Step keys are the machine's; every label and message comes from useCopy.
   Failure copy shown here is presentation only — the REPORTED message stays
   constant in error-copy.ts so fingerprints keep grouping one bug as one
   issue. */
const STEP_KEYS = ["building", "approving", "signing"] as const;
type StepKey = (typeof STEP_KEYS)[number];

const STEP_LABEL: Record<StepKey, (copy: Copy) => string> = {
  building: (copy) => copy.stepBuild,
  approving: (copy) => copy.stepApprove,
  signing: (copy) => copy.stepSign,
};

/**
 * The order stepper: Build → Approve → Sign. `approveNeeded={false}`
 * (withdrawals, native tokens) keeps the Approve dot visible but marks it as
 * skipped. `headless`: the embedded wallet sends with Privy paying the fee
 * and no wallet screen (lib/gas-sponsor), so the steps say what Berth is
 * doing instead of asking for a confirmation nobody can give.
 */
export function ActionStepper({
  step,
  approveNeeded = true,
  headless = false,
  className,
}: {
  step: VaultActionStep;
  approveNeeded?: boolean;
  headless?: boolean;
  className?: string;
}) {
  const copy = useCopy();
  const activeIndex = STEP_KEYS.findIndex((key) => key === step);
  if (activeIndex === -1) return null;

  return (
    <div className={cn("flex flex-col gap-5 px-2 py-4", className)}>
      <p className="text-center font-display text-lg text-foreground">
        {copy.working}
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
                    index <= activeIndex ? "bg-primary" : "bg-border",
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
                      "border-primary bg-primary text-primary-foreground",
                    active && "border-primary bg-card text-primary",
                    skipped && "border-dashed border-border text-muted-foreground",
                    !done && !active && !skipped &&
                      "border-border bg-muted text-muted-foreground",
                  )}
                >
                  {done && !skipped ? (
                    <Check className="size-4" />
                  ) : active ? (
                    // The one animated status element the brand allows,
                    // standing in for the number only while this step is
                    // actually running; the circle itself never resizes, so
                    // nothing around it jumps when the orb mounts or the
                    // step moves on.
                    <ThinkingOrb state="working" size={20} decorative fallback={index + 1} />
                  ) : (
                    index + 1
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
          {stepMessage(STEP_KEYS[activeIndex], copy, headless)}
        </p>
        <p className="text-xs text-muted-foreground">{copy.keepThisOpen}</p>
      </div>
    </div>
  );
}

/**
 * The order-fill tracker, shown while the cross-chain fill completes. The
 * order machine owns the status poll and hands over its phase; solver
 * status codes never reach this component.
 */
export function IntentTracking({
  phase,
  fillTxHash,
  hubTxHash,
  spokeTxHash,
  spokeTxUrl,
  successTitle,
  successBody,
  onDone,
  className,
  reportState = "idle",
}: {
  phase: FillPhase;
  fillTxHash?: string;
  /** The intent's hub transaction, the reference an unsettled order shows. */
  hubTxHash?: string;
  /** The payment on its own chain, while it has not reached Sonic (Bitcoin). */
  spokeTxHash?: string;
  /** Where that payment can be followed (mempool.space for Bitcoin). */
  spokeTxUrl?: string;
  successTitle: string;
  successBody: string;
  onDone: () => void;
  className?: string;
  /** Reporting state for a failed fill, so the screen can say the team has it. */
  reportState?: ReportState;
}) {
  const copy = useCopy();
  if (phase === "filled") {
    return (
      <div className={cn("flex flex-col items-center gap-3 px-3 py-4 text-center", className)}>
        {/* The mark settles into its final frame; the order is done. */}
        <LoadingMark className="size-40" done />
        <div data-ph-mask className="flex flex-col gap-1">
          <p className="font-display text-lg text-foreground">{successTitle}</p>
          <p className="text-sm text-muted-foreground">{successBody}</p>
          {fillTxHash && (
            <p className="money text-xs text-muted-foreground">
              {copy.referenceLabel} {shortenAddress(fillTxHash)}
            </p>
          )}
        </div>
        <Button className="h-12 w-full text-base" onClick={onDone}>
          {copy.done}
        </Button>
      </div>
    );
  }

  if (phase === "failed") {
    return (
      <div className={cn("flex flex-col items-center gap-3 px-3 py-4 text-center", className)}>
        <div className="flex flex-col items-center">
          <div style={{ height: 40 }} />
          <LoadingMark className="size-16 text-destructive" done />
        </div>
        <div className="flex flex-col gap-1">
          <p className="font-display text-lg text-destructive">
            {copy.orderFailedTitle}
          </p>
          <p className="text-sm text-muted-foreground">
            {copy.fillFailedScreenBody}
          </p>
          {reportState === "filed" && (
            <p className="text-xs text-muted-foreground opacity-75">
              {copy.teamTold}
            </p>
          )}
        </div>
        <Button variant="outline" className="h-12 w-full text-base" onClick={onDone}>
          {copy.closeLabel}
        </Button>
      </div>
    );
  }

  if (phase === "confirming" || phase === "notArrived") {
    // Not a failure: the payment left the wallet and is on its way to Sonic.
    // The drawer is free to close; the machine keeps the relay wait going.
    const confirming = phase === "confirming";
    return (
      <div className={cn("flex flex-col items-center gap-3 px-3 py-4 text-center", className)}>
        <div className="flex flex-col items-center">
          <div style={{ height: 40 }} />
          <LoadingMark className="size-16" />
        </div>
        <div className="flex flex-col gap-1">
          <p className="font-display text-lg text-foreground">
            {confirming ? copy.confirmingTitle : copy.unsettledTitle}
          </p>
          <p className="text-sm text-muted-foreground">
            {confirming ? copy.confirmingBody : copy.notArrivedBody}
          </p>
          {(confirming || spokeTxUrl) && (
            <p className="text-xs text-muted-foreground">
              {confirming ? copy.confirmingClose : copy.notArrivedWatching}
            </p>
          )}
          {spokeTxUrl && spokeTxHash && (
            <a
              data-ph-block
              href={spokeTxUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="money text-xs text-muted-foreground underline underline-offset-2"
            >
              {copy.followPayment} ({shortenAddress(spokeTxHash)})
            </a>
          )}
          {!confirming && reportState === "filed" && (
            <p className="text-xs text-muted-foreground opacity-75">
              {copy.teamTold}
            </p>
          )}
        </div>
        <Button variant="outline" className="h-12 w-full text-base" onClick={onDone}>
          {copy.closeLabel}
        </Button>
      </div>
    );
  }

  if (phase === "unsettled") {
    // Not a failure: the order is out and may still settle. The machine keeps
    // polling while this is open and replaces this screen if it does.
    return (
      <div className={cn("flex flex-col items-center gap-3 px-3 py-4 text-center", className)}>
        <div className="flex flex-col items-center">
          <div style={{ height: 40 }} />
          <LoadingMark className="size-16" />
        </div>
        <div className="flex flex-col gap-1">
          <p className="font-display text-lg text-foreground">
            {copy.unsettledTitle}
          </p>
          <p className="text-sm text-muted-foreground">{copy.unsettledBody}</p>
          <p className="text-xs text-muted-foreground">
            {copy.unsettledWatching}
          </p>
          {hubTxHash && (
            <a
              data-ph-block
              href={hubTxUrl(hubTxHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="money text-xs text-muted-foreground underline underline-offset-2"
            >
              {copy.referenceLabel} {shortenAddress(hubTxHash)}
            </a>
          )}
          {reportState === "filed" && (
            <p className="text-xs text-muted-foreground opacity-75">
              {copy.teamTold}
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
      {/* The wait IS the order: the longest-held frame in the app finally
          shows the mark working instead of a scanning bar. */}
      <LoadingMark className="size-40" />
      <div className="flex flex-col gap-1">
        <p className="font-display text-lg text-foreground">
          {copy.settling}
        </p>
        <p className="text-xs text-muted-foreground">
          {filling ? copy.settlingNote : copy.delivering}
        </p>
      </div>
    </div>
  );
}

/**
 * A quiet line on the order form while an earlier order from a slow chain
 * is still travelling after its drawer closed, so nobody pays twice
 * thinking the first one was lost.
 */
export function EarlierOrderNote({
  order,
}: {
  order: { spokeTxHash: string; spokeTxUrl?: string } | null;
}) {
  const copy = useCopy();
  if (!order) return null;
  return (
    <div className="rounded-xl bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground">
      <p>{copy.earlierOrderOnItsWay}</p>
      {order.spokeTxUrl && (
        <a
          data-ph-block
          href={order.spokeTxUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="money mt-1.5 inline-block text-xs underline underline-offset-2"
        >
          {copy.followPayment} ({shortenAddress(order.spokeTxHash)})
        </a>
      )}
    </div>
  );
}

/**
 * The failure message, plus a quiet note when the failure has already been
 * handed to the team. A cancelled order is styled gently and never reported:
 * the user chose it, so there is nothing to look into. The message itself
 * comes from error-copy.ts and stays constant on purpose (fingerprinting);
 * only the report-status note is rendered here.
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
            ? copy.tellingTeam
            : reportState === "filed"
              ? copy.teamToldNoReport
              : null}
        </p>
      )}
    </div>
  );
}
