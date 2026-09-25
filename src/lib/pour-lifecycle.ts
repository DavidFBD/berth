import { SolverIntentStatusCode } from "@sodax/sdk";
import { COPY } from "@/lib/copy";
import type { ErrorReportContext, PourReportContext } from "@/lib/error-report";

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
  | "unsettled"
  | "filled"
  | "fillFailed"
  | "error";

/**
 * What the settling screen should show. Null: no intent handed off yet.
 * `unsettled` is the order that was sent but has not settled inside the
 * bounded wait: not a failure, since the funds may still arrive.
 */
export type FillPhase =
  | "registering"
  | "filling"
  | "unsettled"
  | "filled"
  | "failed";

/**
 * How long a never-terminal status poll may hold the drawer shut. The poll
 * can legitimately never turn terminal (NOT_FOUND / a failing endpoint), so
 * after this bounded wait the pour moves from "tracking" to "unsettled":
 * the lock releases, the user is told the order is still out, and the team
 * gets a report. The poll keeps running while the drawer is open, so a late
 * SOLVED or FAILED still resolves the pour.
 */
export const TRACKING_RELEASE_MS = 90_000;

/** Steps that hand an intent to the solver and wait on its status. */
function isAwaitingFill(step: PourStep): boolean {
  return step === "tracking" || step === "unsettled";
}

/** The user is between first tap and signature. */
export function isPipelineStep(step: PourStep): boolean {
  return step === "building" || step === "approving" || step === "signing";
}

/**
 * Resolve a pour awaiting its fill against the latest solver status. Non-null
 * exactly once per pour: only "tracking" or "unsettled" can resolve, and
 * resolving leaves both, so re-render storms and continued polling cannot
 * re-fire the terminal side effects. An unsettled pour still resolves: a late
 * fill must replace the "not settled yet" message, not sit behind it.
 */
export function resolveTracking(
  step: PourStep,
  statusCode: number | undefined,
): "filled" | "fillFailed" | null {
  if (!isAwaitingFill(step)) return null;
  if (statusCode === SolverIntentStatusCode.SOLVED) return "filled";
  if (statusCode === SolverIntentStatusCode.FAILED) return "fillFailed";
  return null;
}

/**
 * The bounded wait ran out. Only a pour still tracking moves on, so a timer
 * that fires in the same tick as a terminal status cannot undo the fill.
 */
export function releaseTracking(step: PourStep): PourStep {
  return step === "tracking" ? "unsettled" : step;
}

/**
 * The step whose one-shot side effects (toast, XP award, report) are due, if
 * any. `fired` is the last step they already ran for. A pour can fire twice,
 * unsettled and then filled or fillFailed, never the same step twice, so a
 * late fill still gets its toast and award after the unsettled report.
 */
export function dueOneShot(
  step: PourStep,
  fired: PourStep | null,
): "unsettled" | "filled" | "fillFailed" | null {
  if (step !== "unsettled" && step !== "filled" && step !== "fillFailed") {
    return null;
  }
  if (fired === "filled" || fired === "fillFailed") return null;
  return step === fired ? null : step;
}

/** Map the pour's step + raw solver status onto the settling screen's phase. */
export function fillPhase(
  step: PourStep,
  statusCode: number | undefined,
): FillPhase | null {
  if (step === "filled") return "filled";
  if (step === "fillFailed") return "failed";
  if (step === "unsettled") return "unsettled";
  if (step !== "tracking") return null;
  const filling =
    statusCode === SolverIntentStatusCode.NOT_STARTED_YET ||
    statusCode === SolverIntentStatusCode.STARTED_NOT_FINISHED;
  return filling ? "filling" : "registering";
}

/**
 * Whether the drawer must refuse dismissal. Mid-pipeline always locks
 * (dismissing would abandon a wallet prompt); tracking locks until terminal
 * or until the bounded wait moves the pour to "unsettled", because
 * dismissing mid-tracking would drop the intent hash and the only progress
 * view.
 */
export function isPourLocked(step: PourStep): boolean {
  return isPipelineStep(step) || step === "tracking";
}

/** Solver status codes by name, for reports that a person reads. */
export function statusName(statusCode: number | undefined): string {
  if (statusCode === undefined) return "none seen";
  return SolverIntentStatusCode[statusCode] ?? `unknown ${statusCode}`;
}

/** What the order machine knows about an unsettled pour, for its report. */
export type UnsettledFacts = {
  /** The solver's intent hash, from its execution response. */
  intentHash?: string;
  intentId?: string;
  /** The signed transaction on the source chain. */
  spokeTxHash?: string;
  /** The intent's transaction on the Sonic hub, which the status poll keys on. */
  hubTxHash?: string;
  fillTxHash?: string;
  /** The last status code the solver answered with, if it ever answered. */
  lastStatusCode?: number;
  /** How long the pour was tracked before the wait ran out. */
  trackedMs: number;
  /** The status endpoint's latest error text, when it was failing. */
  statusError?: string;
};

/**
 * The report for a pour that was signed and submitted but never reached a
 * terminal status inside the wait. Its own step and code make it its own
 * class of issue, apart from a fill the solver reported as failed. The raw
 * message names only the cause (last status, whether the endpoint answered),
 * so the same kind of stall from two users lands on one issue, while hashes
 * and timings ride in diagnostics and reach that issue as one comment each.
 */
export function unsettledReport(
  context: PourReportContext,
  facts: UnsettledFacts,
): ErrorReportContext {
  const lastStatus = statusName(facts.lastStatusCode);
  const endpoint = facts.statusError ? "erroring" : "answering";
  const diagnostics: Record<string, string | undefined> = {
    intentHash: facts.intentHash,
    intentId: facts.intentId,
    spokeTxHash: facts.spokeTxHash,
    hubTxHash: facts.hubTxHash,
    fillTxHash: facts.fillTxHash,
    lastStatus:
      facts.lastStatusCode === undefined
        ? lastStatus
        : `${lastStatus} (${facts.lastStatusCode})`,
    trackedFor: `${Math.round(facts.trackedMs / 1000)}s`,
    statusEndpoint: facts.statusError
      ? `erroring: ${facts.statusError}`
      : "answering",
  };
  return {
    ...context,
    step: "settling",
    errorCode: "SOLVER_FILL_UNSETTLED",
    friendlyMessage: COPY.unsettledTitle,
    rawMessage: `Solver status never turned terminal for the ${context.action} intent: last status ${lastStatus}, status endpoint ${endpoint}.`,
    txHashes: [facts.spokeTxHash, facts.hubTxHash, facts.fillTxHash].filter(
      (hash): hash is string => !!hash,
    ),
    diagnostics: Object.fromEntries(
      Object.entries(diagnostics).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
  };
}

/**
 * How an unsettled order ended, as a follow-up to its report. The same
 * context as the report (so the same fingerprint, so the same issue), with a
 * one-line note the server posts as a comment rather than a new issue.
 */
export function settledFollowUp(
  unsettled: ErrorReportContext,
  outcome: "filled" | "fillFailed",
  trackedMs: number,
): ErrorReportContext {
  const verb = outcome === "filled" ? "Settled" : "Failed";
  const intent =
    unsettled.diagnostics?.intentHash ?? unsettled.diagnostics?.hubTxHash;
  return {
    ...unsettled,
    followUp: `${verb} after ${Math.round(trackedMs / 1000)}s${
      intent ? `, intent ${intent}` : ""
    }.`,
  };
}
