"use client";

import { track } from "@/lib/analytics";
import { useUnavailableReason } from "@/lib/unavailable-refusal";
import { RECURRING_PATH } from "@/hooks/use-recurring";
import type { Availability } from "@/lib/availability";
import { NotHereDrawer, useAvailability } from "@/components/availability/availability";
import { useEffect, useState } from "react";
import { toast } from "@/lib/toast";
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Chip } from "@/components/flow/limit-price";
import { Toggle } from "@/components/social/social-section";
import { useCopy } from "@/components/settings-provider";
import { onPlanSheet, openPlanSheet, type PlanSheetRequest } from "@/components/recurring/plan-sheet-events";
import { useAccountHeaders } from "@/hooks/use-profile";
import { RecurringError, useRecurring, useRecurringAction } from "@/hooks/use-recurring";
import { TOKEN_LISTINGS } from "@/lib/listings";
import {
  MIN_PLAN_USD,
  PLAN_LINK_KEYS,
  checkPlan,
  resumeLeft,
  dueDayWords,
  readPlanParams,
  firstDueAt,
  ordinal,
  type Cadence,
  type PlanInput,
} from "@/lib/recurring";
import { cn } from "@/lib/utils";

/**
 * The plan sheet: a listing, an amount, weekly on a weekday or monthly on
 * a day from 1 to 28, and, for accounts with limit orders, "Buy on the
 * dip". Saving sets a reminder, nothing more: Berth never buys by itself.
 * PlanSheetHost (mounted once, by Home) opens it for whoever asks
 * (plan-sheet-events); PlanSheetView is the sheet itself, for the gallery.
 */

const STOCKS = TOKEN_LISTINGS.filter((listing) => listing.kind === "stock");

function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export type PlanDraftState = {
  symbol: string;
  usdText: string;
  cadence: Cadence;
  weekday: number;
  monthDay: number;
  dip: boolean;
  dipText: string;
};

export function draftFromRequest(request: PlanSheetRequest): PlanDraftState {
  const cadence = request.cadence ?? "weekly";
  return {
    symbol: request.symbol && STOCKS.some((listing) => listing.symbol === request.symbol) ? request.symbol : (STOCKS[0]?.symbol ?? ""),
    usdText: request.usd ? String(Number(request.usd.toFixed(2))) : "",
    cadence,
    weekday: cadence === "weekly" && request.day !== undefined && request.day >= 0 && request.day <= 6 ? request.day : 1,
    monthDay: cadence === "monthly" && request.day !== undefined && request.day >= 1 && request.day <= 28 ? request.day : 1,
    dip: request.dipPct !== undefined,
    dipText: request.dipPct !== undefined ? String(request.dipPct) : "5",
  };
}

export function planInputOf(state: PlanDraftState, timeZone: string): PlanInput {
  return {
    listing: state.symbol,
    usd: Number(state.usdText.replace(/[$,\s]/g, "")),
    cadence: state.cadence,
    weekday: state.cadence === "weekly" ? state.weekday : null,
    monthDay: state.cadence === "monthly" ? state.monthDay : null,
    timeZone,
    orderType: state.dip ? "limit" : "market",
    dipPct: state.dip ? Number(state.dipText.replace(/[%\s]/g, "")) : null,
  };
}

/**
 * `onSignIn`: signed out (an Assistant's /?plan= link in a browser not
 * signed in to Berth), the sheet offers sign in instead of Save, keeps
 * what was chosen, and opens again with it once the account is there.
 */
export function PlanSheetHost({ onSignIn, onClosed }: { onSignIn?: () => void; onClosed?: () => void } = {}) {
  const copy = useCopy().recurring;
  // The page's answer, or the route's own 451 on a plan action (hooks/use-recurring).
  const pageAvailability = useAvailability();
  const refusedFor = useUnavailableReason(RECURRING_PATH);
  const refusedHere = refusedFor !== null;
  const availability: Availability =
    !pageAvailability.available || refusedFor === null ? pageAvailability : { available: false, reason: refusedFor };
  const recurring = useRecurring();
  const action = useRecurringAction();
  const { key } = useAccountHeaders({ prompt: false });
  const signedOut = key === null;
  // Waiting for a sign in the sheet asked for, to open again with the same
  // draft: when it was asked, so the draft lapses (PLAN_RESUME_MS) if the
  // person walks away from the sign in and comes back hours later.
  const [resumeSince, setResumeSince] = useState<number | null>(null);
  const resume = resumeSince !== null;
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState<PlanSheetRequest>({});
  const [state, setState] = useState<PlanDraftState>(() => draftFromRequest({}));
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(
    () =>
      onPlanSheet((next) => {
        track("recurring_started", { via: next.via ?? "app", editing: Boolean(next.planId) });
        setRequest(next);
        setState(draftFromRequest(next));
        setProblem(null);
        setOpen(true);
      }),
    [],
  );

  // An assistant's draft_recurring link (lib/recurring planDraftUrl): read
  // once, taken out of the address bar, and opened filled in. Nothing is
  // saved until the person saves.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const drafted = readPlanParams(params);
    if (!drafted) return;
    const url = new URL(window.location.href);
    for (const key of PLAN_LINK_KEYS) url.searchParams.delete(key);
    window.history.replaceState(window.history.state, "", url);
    openPlanSheet({ symbol: drafted.symbol, usd: drafted.usd, cadence: drafted.cadence, day: drafted.day, dipPct: drafted.dipPct, via: "assistant" });
    toast(copy.planOpened);
  }, [copy.planOpened]);

  // Back from the sign in the sheet asked for: open again, with the same draft.
  const shown = open || (resume && !signedOut);

  // Still signed out when the wait lapses: the draft goes. Signed in, the sheet is showing and the timer stops.
  useEffect(() => {
    if (resumeSince === null || !signedOut) return;
    const timer = setTimeout(() => setResumeSince(null), resumeLeft(resumeSince, Date.now()));
    return () => clearTimeout(timer);
  }, [resumeSince, signedOut]);

  const signIn = () => {
    setResumeSince(Date.now());
    setOpen(false);
    onSignIn?.();
  };

  const save = () => {
    // An edit keeps the plan's own zone unless the day itself changes: amending the amount from
    // another city never moves the plan there.
    const edited = request.planId ? recurring.plans.find((plan) => plan.id === request.planId) : undefined;
    const sameDay =
      edited !== undefined &&
      edited.cadence === state.cadence &&
      (state.cadence === "weekly" ? edited.weekday === state.weekday : edited.monthDay === state.monthDay);
    const zone = sameDay ? edited.timeZone : browserZone();
    const input = planInputOf(state, zone);
    const checked = checkPlan(input, { limitAllowed: recurring.limitAllowed });
    if (!checked.ok) {
      setProblem(copy.errors[checked.reason]);
      return;
    }
    setProblem(null);
    const body = request.planId
      ? ({ action: "update", planId: request.planId, plan: input } as const)
      : ({ action: "create", plan: input, via: request.via ?? "app" } as const);
    action.mutate(body, {
      onSuccess: () => {
        track("recurring_saved", { cadence: state.cadence, via: request.via ?? "app", editing: Boolean(request.planId), dip: state.dip });
        setOpen(false);
        setResumeSince(null);
        onClosed?.();
        const first = sameDay ? Date.parse(edited.nextDueAt) : firstDueAt(checked.plan.schedule, Date.now());
        toast.success(copy.saved(dueDayWords(first, zone)));
      },
      onError: (error) => {
        const reason = error instanceof RecurringError ? error.reason : "failed";
        if (reason === "no session") {
          setProblem(copy.signInToSave);
          return;
        }
        setProblem(reason in copy.errors ? copy.errors[reason as keyof typeof copy.errors] : copy.errors.failed);
      },
    });
  };

  // Where Berth is not available (lib/availability) no plan is made: the
  // sheet says so instead. Existing plans can still be paused or deleted.
  if (!availability.available || refusedHere) {
    return (
      <NotHereDrawer
        availability={availability}
        open={shown}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) return;
          setResumeSince(null);
          onClosed?.();
        }}
      />
    );
  }

  return (
    <PlanSheetView
      open={shown}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) return;
        setResumeSince(null);
        onClosed?.();
      }}
      state={state}
      onChange={(patch) => {
        setProblem(null);
        setState((current) => ({ ...current, ...patch }));
      }}
      limitAllowed={recurring.limitAllowed}
      problem={problem}
      // Until the list says whether dip plans are open here, a save could be refused for the wrong reason.
      saving={action.isPending || (!signedOut && !recurring.loaded)}
      onSave={save}
      signIn={signedOut && onSignIn ? signIn : undefined}
    />
  );
}

export function PlanSheetView({
  open,
  onOpenChange,
  state,
  onChange,
  limitAllowed,
  problem,
  saving,
  onSave,
  signIn,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: PlanDraftState;
  onChange: (patch: Partial<PlanDraftState>) => void;
  limitAllowed: boolean;
  problem: string | null;
  saving: boolean;
  onSave: () => void;
  /** Signed out: the footer offers this instead of Save. */
  signIn?: () => void;
}) {
  const copy = useCopy().recurring;
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{copy.sheetTitle}</DrawerTitle>
          <DrawerDescription>{copy.sheetSub}</DrawerDescription>
        </DrawerHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 pb-2" data-testid="plan-sheet" data-ph-mask>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">{copy.listingLabel}</span>
            <select
              value={state.symbol}
              onChange={(event) => onChange({ symbol: event.target.value })}
              className="h-11 rounded-lg border border-border bg-card px-3 text-[15px] text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {STOCKS.map((listing) => (
                <option key={listing.symbol} value={listing.symbol}>
                  {listing.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">{copy.amountLabel}</span>
            <span className="flex items-baseline gap-0.5">
              <span aria-hidden className={cn("text-3xl font-semibold tabular-nums", state.usdText ? "text-foreground" : "text-muted-foreground/40")}>
                $
              </span>
              <input
                value={state.usdText}
                onChange={(event) => onChange({ usdText: event.target.value })}
                inputMode="decimal"
                autoComplete="off"
                spellCheck={false}
                placeholder={String(MIN_PLAN_USD * 20)}
                aria-label={copy.amountLabel}
                className="w-full bg-transparent text-3xl font-semibold text-foreground tabular-nums outline-none placeholder:text-muted-foreground/40"
              />
            </span>
          </label>

          <div className="flex flex-col gap-2">
            <div className="flex gap-1.5" role="group">
              <Chip selected={state.cadence === "weekly"} onClick={() => onChange({ cadence: "weekly" })}>
                {copy.weekly}
              </Chip>
              <Chip selected={state.cadence === "monthly"} onClick={() => onChange({ cadence: "monthly" })}>
                {copy.monthly}
              </Chip>
            </div>
            {state.cadence === "weekly" ? (
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={copy.weekly}>
                {/* Monday first, as a week reads. */}
                {[1, 2, 3, 4, 5, 6, 0].map((day) => (
                  <Chip key={day} selected={state.weekday === day} onClick={() => onChange({ weekday: day })}>
                    <span aria-label={copy.weekdays[day]}>{copy.weekdaysShort[day]}</span>
                  </Chip>
                ))}
              </div>
            ) : (
              <label className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">{copy.dayOfMonth}</span>
                <select
                  value={state.monthDay}
                  onChange={(event) => onChange({ monthDay: Number(event.target.value) })}
                  className="h-9 rounded-full border border-border bg-card px-3 text-[13px] text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {Array.from({ length: 28 }, (_, index) => index + 1).map((day) => (
                    <option key={day} value={day}>
                      {ordinal(day)}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {/* Shown whenever dip is on, too, so a drafted dip can always be switched off. */}
          {(limitAllowed || state.dip) && (
            <div className="flex flex-col gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-foreground">{copy.dipLabel}</span>
                <Toggle label={copy.dipLabel} on={state.dip} onChange={(on) => onChange({ dip: on })} />
              </div>
              {state.dip && (
                <label className="flex items-center gap-2">
                  <input
                    value={state.dipText}
                    onChange={(event) => onChange({ dipText: event.target.value })}
                    inputMode="decimal"
                    aria-label={copy.dipPctLabel}
                    className="w-14 rounded-lg border border-border bg-background px-2 py-1 text-sm text-foreground tabular-nums outline-none"
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                  <span className="text-xs text-muted-foreground">{copy.dipSub(`${state.dipText || "0"}%`)}</span>
                </label>
              )}
            </div>
          )}

          <p className="text-xs text-muted-foreground">{copy.nothingUntil}</p>
          {signIn && <p className="text-sm text-foreground">{copy.signInToSave}</p>}
          {problem && (
            <p className="text-sm text-destructive" role="alert">
              {problem}
            </p>
          )}
        </div>
        <DrawerFooter>
          {signIn ? (
            <Button className="h-12 w-full text-base" onClick={signIn}>
              {copy.signInToSaveButton}
            </Button>
          ) : (
            <Button className="h-12 w-full text-base" disabled={saving} onClick={onSave}>
              {saving && <Spinner className="size-4" />}
              {copy.save}
            </Button>
          )}
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
