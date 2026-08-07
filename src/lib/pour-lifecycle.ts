import { SolverIntentStatusCode } from "@sodax/sdk";

/**
 * The pour lifecycle: every step a pour passes through, from first tap to
 * solver fill. One union for both directions — `useVaultAction` owns the
 * transitions, this module owns what each state means, so the terminal
 * one-shot semantics (toast once, award once, report once) are enforced by
 * the step transition itself rather than by guard refs in every caller.
 */
export type PourStep =
  | "idle"
  | "building"
  | "approving"
  | "signing"
  | "tracking"
  | "filled"
  | "fillFailed"
  | "error";

/** What the steeping screen should show. Null: no intent handed off yet. */
export type FillPhase = "registering" | "filling" | "filled" | "failed";

/**
 * How long a never-terminal status poll may hold the drawer shut. The poll
 * can legitimately never turn terminal (NOT_FOUND / a failing endpoint), so
 * the dismissal lock releases after a bounded wait rather than trapping the
 * user forever.
 */
export const TRACKING_RELEASE_MS = 90_000;

/** The user is between first tap and signature. */
export function isPipelineStep(step: PourStep): boolean {
  return step === "building" || step === "approving" || step === "signing";
}

/**
 * Resolve a tracking pour against the latest solver status. Non-null exactly
 * once per pour: only the "tracking" step can resolve, and resolving leaves
 * it, so re-render storms and continued polling cannot re-fire the terminal
 * side effects.
 */
export function resolveTracking(
  step: PourStep,
  statusCode: number | undefined,
): "filled" | "fillFailed" | null {
  if (step !== "tracking") return null;
  if (statusCode === SolverIntentStatusCode.SOLVED) return "filled";
  if (statusCode === SolverIntentStatusCode.FAILED) return "fillFailed";
  return null;
}

/** Map the pour's step + raw solver status onto the steeping screen's phase. */
export function fillPhase(
  step: PourStep,
  statusCode: number | undefined,
): FillPhase | null {
  if (step === "filled") return "filled";
  if (step === "fillFailed") return "failed";
  if (step !== "tracking") return null;
  const filling =
    statusCode === SolverIntentStatusCode.NOT_STARTED_YET ||
    statusCode === SolverIntentStatusCode.STARTED_NOT_FINISHED;
  return filling ? "filling" : "registering";
}

/**
 * Whether the drawer must refuse dismissal. Mid-pipeline always locks
 * (dismissing would abandon a wallet prompt); tracking locks until terminal
 * or until the bounded wait releases it — dismissing mid-tracking would drop
 * the intent hash and the only progress view.
 */
export function isPourLocked(
  step: PourStep,
  trackingTimedOut: boolean,
): boolean {
  if (isPipelineStep(step)) return true;
  return step === "tracking" && !trackingTimedOut;
}
