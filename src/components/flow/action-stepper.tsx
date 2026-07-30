"use client";

import { Check, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { shortenAddress } from "@/lib/format";
import type { VaultActionStep } from "@/hooks/use-vault-action";

const STEPS = [
  { key: "building", label: "Build" },
  { key: "approving", label: "Approve" },
  { key: "signing", label: "Sign" },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

const STEP_MESSAGE: Record<StepKey, string> = {
  building: "Preparing your order…",
  approving: "Approve the token in your wallet…",
  signing: "Confirm the transaction in your wallet…",
};

/**
 * Three-dot Build → Approve → Sign progress indicator shown while a vault
 * action is in flight. `approveNeeded={false}` (withdrawals, native tokens)
 * keeps the Approve dot visible but marks it as skipped.
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
    <div className={cn("flex flex-col items-center gap-6 py-6", className)}>
      <div className="flex items-center gap-2">
        {STEPS.map((s, index) => {
          const skipped = s.key === "approving" && !approveNeeded;
          const done = index < activeIndex || (skipped && index <= activeIndex);
          const active = index === activeIndex && !skipped;
          return (
            <div key={s.key} className="flex items-center gap-2">
              {index > 0 && (
                <div
                  className={cn(
                    "h-px w-8",
                    index <= activeIndex ? "bg-primary" : "bg-border",
                  )}
                />
              )}
              <div className="flex flex-col items-center gap-1.5">
                <div
                  className={cn(
                    "flex size-8 items-center justify-center rounded-full border text-xs font-medium transition-colors",
                    done && !skipped &&
                      "border-primary bg-primary text-primary-foreground",
                    active && "border-primary text-primary",
                    skipped && "border-dashed border-border text-muted-foreground",
                    !done && !active && !skipped &&
                      "border-border text-muted-foreground",
                  )}
                >
                  {done && !skipped ? (
                    <Check className="size-4" />
                  ) : active ? (
                    <Spinner className="size-4" />
                  ) : (
                    index + 1
                  )}
                </div>
                <span
                  className={cn(
                    "text-[11px]",
                    active ? "font-medium text-foreground" : "text-muted-foreground",
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
          Keep this screen open until it completes.
        </p>
      </div>
    </div>
  );
}

/**
 * Presentational cross-chain fill tracker. Callers own the `useStatus` poll
 * and pass the raw solver status code down:
 * -1 / undefined → registering, 1 / 2 → filling, 3 → solved, 4 → failed.
 */
export function IntentTracking({
  statusCode,
  fillTxHash,
  successTitle,
  successBody,
  onDone,
  className,
}: {
  statusCode: number | undefined;
  fillTxHash?: string;
  successTitle: string;
  successBody: string;
  onDone: () => void;
  className?: string;
}) {
  if (statusCode === 3) {
    return (
      <div className={cn("flex flex-col items-center gap-4 py-6 text-center", className)}>
        <div className="flex size-14 items-center justify-center rounded-full bg-emerald-500/15">
          <Check className="size-7 text-emerald-500" />
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-base font-semibold text-foreground">{successTitle}</p>
          <p className="text-sm text-muted-foreground">{successBody}</p>
          {fillTxHash && (
            <p className="font-mono text-xs text-muted-foreground tabular-nums">
              Fill tx {shortenAddress(fillTxHash)}
            </p>
          )}
        </div>
        <Button className="h-12 w-full text-base" onClick={onDone}>
          Done
        </Button>
      </div>
    );
  }

  if (statusCode === 4) {
    return (
      <div className={cn("flex flex-col items-center gap-4 py-6 text-center", className)}>
        <div className="flex size-14 items-center justify-center rounded-full bg-destructive/10">
          <CircleAlert className="size-7 text-destructive" />
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-base font-semibold text-foreground">
            The solver couldn&apos;t fill this order
          </p>
          <p className="text-sm text-muted-foreground">
            Your funds are safe. If they don&apos;t reappear in your wallet
            shortly, contact SODAX support with your transaction hash.
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
    <div className={cn("flex flex-col items-center gap-4 py-10 text-center", className)}>
      <Spinner className="size-8 text-primary" />
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">
          {filling ? "Solver filling your order…" : "Registering intent…"}
        </p>
        <p className="text-xs text-muted-foreground">
          {filling
            ? "This usually takes under a minute."
            : "Waiting for your transaction to reach the solver network."}
        </p>
      </div>
    </div>
  );
}
