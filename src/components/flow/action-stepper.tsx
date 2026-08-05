"use client";

import { Check } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { shortenAddress } from "@/lib/format";
import { SteamPlume, TeapotArt } from "@/components/tea/tea-art";
import {
  CANCELLED_MESSAGE,
  type ReportState,
  type VaultActionStep,
} from "@/hooks/use-vault-action";

const STEPS = [
  { key: "building", label: "Build" },
  { key: "approving", label: "Approve" },
  { key: "signing", label: "Sign" },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

/* The brewing ritual — per the design system's pour flow microcopy. */
const STEP_MESSAGE: Record<StepKey, string> = {
  building: "Measuring the leaves…",
  approving: "Warming the pot. Approve in your wallet…",
  signing: "One gentle stir. Confirm in your wallet…",
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
  const activeIndex = STEPS.findIndex((s) => s.key === step);
  if (activeIndex === -1) return null;

  return (
    <div className={cn("flex flex-col gap-5 px-2 py-4", className)}>
      <p className="text-center font-display text-lg text-foreground">Brewing…</p>
      <div className="flex items-center">
        {STEPS.map((s, index) => {
          const skipped = s.key === "approving" && !approveNeeded;
          const done = index < activeIndex || (skipped && index <= activeIndex);
          const active = index === activeIndex && !skipped;
          return (
            <div key={s.key} className={cn("flex items-center", index > 0 && "flex-1")}>
              {index > 0 && (
                <div
                  className={cn(
                    "mx-1.5 h-0.5 flex-1 rounded-full transition-colors",
                    index <= activeIndex ? "bg-accent" : "bg-border",
                  )}
                  style={{
                    transitionDuration: "var(--duration-pour)",
                    transitionTimingFunction: "var(--ease-tea)",
                  }}
                />
              )}
              <div className="flex flex-col items-center gap-1.5">
                <div
                  className={cn(
                    "relative grid size-7.5 place-items-center rounded-full border-2 text-[13px] font-bold transition-all",
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
                      className="absolute inset-0 rounded-full border-2 border-accent opacity-40"
                      style={{
                        animation: "steam-drift 1.6s var(--ease-tea) infinite",
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
                  {s.label}
                  {skipped && (
                    <span className="block text-center text-[9px] leading-tight text-muted-foreground/70">
                      skipped
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
          {STEP_MESSAGE[STEPS[activeIndex].key]}
        </p>
        <p className="text-xs text-muted-foreground">
          Keep this open, good tea takes a minute.
        </p>
      </div>
    </div>
  );
}

/**
 * The steeping tracker (design system SteepingTracker) — shown while the
 * cross-chain fill completes. Callers own the `useStatus` poll and pass the
 * raw solver status code: -1 / undefined → registering, 1 / 2 → steeping,
 * 3 → poured, 4 → kettle trouble.
 */
export function IntentTracking({
  statusCode,
  fillTxHash,
  successTitle,
  successBody,
  onDone,
  accent = "var(--cup-breakfast-deep)",
  className,
}: {
  statusCode: number | undefined;
  fillTxHash?: string;
  successTitle: string;
  successBody: string;
  onDone: () => void;
  accent?: string;
  className?: string;
}) {
  if (statusCode === 3) {
    return (
      <div className={cn("flex flex-col items-center gap-3 px-3 py-4 text-center", className)}>
        <div className="flex flex-col items-center">
          <SteamPlume level={4} bloom width={64} height={40} />
          <TeapotArt size={64} />
        </div>
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
          Lovely
        </Button>
      </div>
    );
  }

  if (statusCode === 4) {
    return (
      <div className={cn("flex flex-col items-center gap-3 px-3 py-4 text-center", className)}>
        <div className="flex flex-col items-center">
          <div style={{ height: 40 }} />
          <TeapotArt size={64} />
        </div>
        <div className="flex flex-col gap-1">
          <p className="font-display text-lg text-destructive">
            The kettle&apos;s acting up.
          </p>
          <p className="text-sm text-muted-foreground">
            Nothing was lost and your funds are safe. If they don&apos;t reappear
            shortly, keep the fill hash handy for support.
          </p>
        </div>
        <Button variant="outline" className="h-12 w-full text-base" onClick={onDone}>
          Close
        </Button>
      </div>
    );
  }

  const filling = statusCode === 1 || statusCode === 2;
  return (
    <div className={cn("flex flex-col items-center gap-3 px-3 py-6 text-center", className)}>
      <div className="flex flex-col items-center">
        <SteamPlume level={2} width={64} height={40} />
        <TeapotArt size={64} />
      </div>
      <div className="flex flex-col gap-1">
        <p className="font-display text-lg text-foreground">
          Your tea is steeping…
        </p>
        <p className="text-xs text-muted-foreground">
          {filling
            ? "Good tea takes a minute, usually less."
            : "Carrying the tray over to the solver network."}
        </p>
      </div>
      <div className="mt-1 h-1 w-40 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full w-2/5 rounded-full"
          style={{
            background: accent,
            animation: "steep-scan 1.8s var(--ease-tea) infinite",
          }}
        />
      </div>
    </div>
  );
}

/**
 * The failure message, plus a quiet note when the failure has already been
 * handed to the team. A cancelled pour is styled gently and never reported:
 * the user chose it, so there is nothing to look into.
 */
export function ActionError({
  message,
  reportState,
}: {
  message: string;
  reportState: ReportState;
}) {
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
            ? "Letting the kitchen know…"
            : reportState === "filed"
              ? "The kitchen has been told, so someone can look into it. No need to report it."
              : null}
        </p>
      )}
    </div>
  );
}
