import { describe, expect, it, vi } from "vitest";
import { SolverIntentStatusCode } from "@sodax/sdk";
import { fingerprintOf, type ErrorReportContext } from "./error-report";
import {
  dueOneShot,
  fillPhase,
  isPipelineStep,
  isPourLocked,
  releaseTracking,
  resolveTracking,
  settledFollowUp,
  unsettledReport,
  type PourStep,
} from "./pour-lifecycle";

const SOLVED = SolverIntentStatusCode.SOLVED;
const FAILED = SolverIntentStatusCode.FAILED;
const NOT_STARTED = SolverIntentStatusCode.NOT_STARTED_YET;
const STARTED = SolverIntentStatusCode.STARTED_NOT_FINISHED;

describe("resolveTracking", () => {
  it("resolves a tracking pour on terminal status", () => {
    expect(resolveTracking("tracking", SOLVED)).toBe("filled");
    expect(resolveTracking("tracking", FAILED)).toBe("fillFailed");
  });

  it("holds while the solver is still working", () => {
    expect(resolveTracking("tracking", undefined)).toBeNull();
    expect(resolveTracking("tracking", NOT_STARTED)).toBeNull();
    expect(resolveTracking("tracking", STARTED)).toBeNull();
  });

  it("is one-shot: an already-resolved pour never re-resolves", () => {
    // The terminal side effects (toast, XP award, failure report) hang off a
    // non-null resolution, so these must stay null however long the status
    // poll keeps returning the terminal code.
    expect(resolveTracking("filled", SOLVED)).toBeNull();
    expect(resolveTracking("fillFailed", FAILED)).toBeNull();
  });

  it("still resolves an unsettled pour when a late status arrives", () => {
    expect(resolveTracking("unsettled", SOLVED)).toBe("filled");
    expect(resolveTracking("unsettled", FAILED)).toBe("fillFailed");
    expect(resolveTracking("unsettled", STARTED)).toBeNull();
  });

  it("never resolves outside tracking", () => {
    const steps: PourStep[] = ["idle", "building", "approving", "signing", "error"];
    for (const step of steps) {
      expect(resolveTracking(step, SOLVED)).toBeNull();
      expect(resolveTracking(step, FAILED)).toBeNull();
    }
  });
});

describe("fillPhase", () => {
  it("is null before an intent is handed off", () => {
    const steps: PourStep[] = ["idle", "building", "approving", "signing", "error"];
    for (const step of steps) expect(fillPhase(step, undefined)).toBeNull();
  });

  it("distinguishes registering from filling while tracking", () => {
    expect(fillPhase("tracking", undefined)).toBe("registering");
    expect(fillPhase("tracking", -1)).toBe("registering");
    expect(fillPhase("tracking", NOT_STARTED)).toBe("filling");
    expect(fillPhase("tracking", STARTED)).toBe("filling");
  });

  it("reports terminal phases from the step, not the poll", () => {
    // After resolution the poll may keep answering, or stop answering — the
    // screen must not care.
    expect(fillPhase("filled", undefined)).toBe("filled");
    expect(fillPhase("fillFailed", undefined)).toBe("failed");
  });

  it("shows an unsettled pour as unsettled, whatever the poll last said", () => {
    expect(fillPhase("unsettled", undefined)).toBe("unsettled");
    expect(fillPhase("unsettled", STARTED)).toBe("unsettled");
  });
});

describe("isPourLocked", () => {
  it("locks through the whole pipeline", () => {
    expect(isPourLocked("building")).toBe(true);
    expect(isPourLocked("approving")).toBe(true);
    expect(isPourLocked("signing")).toBe(true);
  });

  it("locks while tracking, until the bounded wait makes it unsettled", () => {
    expect(isPourLocked("tracking")).toBe(true);
    expect(isPourLocked("unsettled")).toBe(false);
  });

  it("never locks a settled pour", () => {
    for (const step of ["idle", "filled", "fillFailed", "error"] as PourStep[]) {
      expect(isPourLocked(step)).toBe(false);
    }
  });
});

describe("isPipelineStep", () => {
  it("covers exactly the pre-signature steps", () => {
    const pipeline: PourStep[] = ["building", "approving", "signing"];
    const rest: PourStep[] = [
      "idle",
      "tracking",
      "unsettled",
      "filled",
      "fillFailed",
      "error",
    ];
    for (const step of pipeline) expect(isPipelineStep(step)).toBe(true);
    for (const step of rest) expect(isPipelineStep(step)).toBe(false);
  });
});

describe("releaseTracking", () => {
  it("moves a pour still tracking to unsettled, not failed", () => {
    expect(releaseTracking("tracking")).toBe("unsettled");
  });

  it("leaves a pour that already resolved alone", () => {
    // The timer can fire in the same tick as a terminal status.
    for (const step of ["filled", "fillFailed", "unsettled", "idle", "error"] as PourStep[]) {
      expect(releaseTracking(step)).toBe(step);
    }
  });
});

const context = {
  action: "deposit",
  step: "tracking",
  vaultName: "NVDAon",
  srcChainKey: "0x2105.base",
  tokenSymbol: "USDC",
  amount: "25000000 (raw, 6dp)",
  addressHint: "0xcFCd…4165",
  walletMode: "email",
} as const;

const facts = (overrides: Partial<Parameters<typeof unsettledReport>[1]> = {}) => ({
  intentHash: "0x" + "a".repeat(64),
  intentId: "4242",
  spokeTxHash: "0x" + "b".repeat(64),
  hubTxHash: "0x" + "c".repeat(64),
  lastStatusCode: STARTED,
  trackedMs: 90_400,
  ...overrides,
});

/**
 * The machine's release path, as `useVaultAction` runs it: render-time
 * resolution, the bounded wait's timer, and the one-shot effect. Renders are
 * replayed with the solver never turning terminal, then turning SOLVED late.
 */
function replay(statuses: (number | undefined)[], releaseAfter: number) {
  const report = vi.fn<(context: ErrorReportContext) => void>();
  const toasts: string[] = [];
  let step: PourStep = "tracking";
  let fired: PourStep | null = null;
  statuses.forEach((status, render) => {
    if (render === releaseAfter) step = releaseTracking(step);
    step = resolveTracking(step, status) ?? step;
    const due = dueOneShot(step, fired);
    if (!due) return;
    fired = due;
    if (due === "unsettled") {
      report(unsettledReport(context, facts({ lastStatusCode: status })));
    } else {
      toasts.push(due);
    }
  });
  return { report, toasts, step };
}

describe("the unsettled release", () => {
  it("reports once, with the settling step, however long the poll goes on", () => {
    const { report, toasts, step } = replay(
      [NOT_STARTED, STARTED, STARTED, STARTED, STARTED, undefined, STARTED],
      3,
    );
    expect(step).toBe("unsettled");
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][0].step).toBe("settling");
    expect(report.mock.calls[0][0].errorCode).toBe("SOLVER_FILL_UNSETTLED");
    expect(toasts).toEqual([]);
  });

  it("lets a late fill through after the report, exactly once", () => {
    const { report, toasts, step } = replay(
      [STARTED, STARTED, STARTED, SOLVED, SOLVED, SOLVED],
      1,
    );
    expect(step).toBe("filled");
    expect(report).toHaveBeenCalledTimes(1);
    expect(toasts).toEqual(["filled"]);
  });

  it("never reports a pour that filled inside the wait", () => {
    const { report, toasts } = replay([STARTED, SOLVED, SOLVED, SOLVED], 2);
    expect(report).not.toHaveBeenCalled();
    expect(toasts).toEqual(["filled"]);
  });
});

describe("dueOneShot", () => {
  it("never fires the same step twice, and nothing after a terminal one", () => {
    expect(dueOneShot("unsettled", null)).toBe("unsettled");
    expect(dueOneShot("unsettled", "unsettled")).toBeNull();
    expect(dueOneShot("filled", "unsettled")).toBe("filled");
    expect(dueOneShot("filled", "filled")).toBeNull();
    expect(dueOneShot("fillFailed", "filled")).toBeNull();
    expect(dueOneShot("tracking", null)).toBeNull();
  });
});

describe("unsettledReport", () => {
  it("carries everything triage needs", () => {
    const report = unsettledReport(
      context,
      facts({ fillTxHash: "0x" + "d".repeat(64), statusError: "503 upstream" }),
    );
    expect(report.txHashes).toEqual([
      "0x" + "b".repeat(64),
      "0x" + "c".repeat(64),
      "0x" + "d".repeat(64),
    ]);
    expect(report.diagnostics).toMatchObject({
      intentHash: "0x" + "a".repeat(64),
      intentId: "4242",
      lastStatus: "STARTED_NOT_FINISHED (2)",
      trackedFor: "90s",
      statusEndpoint: "erroring: 503 upstream",
    });
    expect(report.vaultName).toBe("NVDAon");
    expect(report.amount).toBe("25000000 (raw, 6dp)");
    expect(report.srcChainKey).toBe("0x2105.base");
    expect(report.rawMessage).toContain("status endpoint erroring");
  });

  it("says when the solver never answered at all", () => {
    const report = unsettledReport(context, facts({ lastStatusCode: undefined }));
    expect(report.diagnostics?.lastStatus).toBe("none seen");
    expect(report.diagnostics?.statusEndpoint).toBe("answering");
  });

  it("groups two intents stuck the same way, whatever their hashes and timings", () => {
    const one = unsettledReport(context, facts());
    const two = unsettledReport(
      context,
      facts({
        intentHash: "0x" + "e".repeat(64),
        hubTxHash: "0x" + "f".repeat(64),
        trackedMs: 91_900,
      }),
    );
    expect(fingerprintOf(one)).toBe(fingerprintOf(two));
    // The details that tell them apart still ride along.
    expect(one.diagnostics?.hubTxHash).not.toBe(two.diagnostics?.hubTxHash);
  });

  it("keeps different stalls, and a failed fill, on different issues", () => {
    const started = unsettledReport(context, facts());
    const notFound = unsettledReport(
      context,
      facts({ lastStatusCode: SolverIntentStatusCode.NOT_FOUND }),
    );
    const erroring = unsettledReport(context, facts({ statusError: "timeout" }));
    const failedFill: ErrorReportContext = {
      ...context,
      step: "filling",
      errorCode: "SOLVER_FILL_FAILED",
      friendlyMessage: "The order could not be filled.",
      rawMessage: "Solver reported status 4 (failed) for the deposit intent.",
    };
    const prints = [started, notFound, erroring, failedFill].map(fingerprintOf);
    expect(new Set(prints).size).toBe(4);
  });
});

describe("settledFollowUp", () => {
  it("says how the order ended, on the same issue as its report", () => {
    const sent = unsettledReport(context, facts());
    const settled = settledFollowUp(sent, "filled", 143_200);
    const failed = settledFollowUp(sent, "fillFailed", 200_000);
    expect(settled.followUp).toBe(`Settled after 143s, intent ${"0x" + "a".repeat(64)}.`);
    expect(failed.followUp).toMatch(/^Failed after 200s, intent 0x/);
    expect(fingerprintOf(settled)).toBe(fingerprintOf(sent));
    expect(fingerprintOf(failed)).toBe(fingerprintOf(sent));
  });
});
