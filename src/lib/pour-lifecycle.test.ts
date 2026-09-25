import { describe, expect, it, vi } from "vitest";
import { ChainKeys, SolverIntentStatusCode } from "@sodax/sdk";
import { fingerprintOf, type ErrorReportContext } from "./error-report";
import {
  BITCOIN_INTENT_DEADLINE_SECONDS,
  BITCOIN_RELAY_WAIT_MS,
  dueOneShot,
  fillPhase,
  isPipelineStep,
  isPourLocked,
  releaseTracking,
  resolveTracking,
  settledFollowUp,
  slowSource,
  solverNotNotifiedReport,
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

describe("a payment from Bitcoin", () => {
  const BTC = ChainKeys.BITCOIN_MAINNET;
  const btcContext = { ...context, srcChainKey: BTC, tokenSymbol: "BTC" } as const;
  const txid = "f".repeat(64);

  it("gets a Bitcoin sized relay wait and intent window", () => {
    const slow = slowSource(BTC);
    expect(slow).toEqual({
      relayWaitMs: BITCOIN_RELAY_WAIT_MS,
      intentDeadlineSeconds: BITCOIN_INTENT_DEADLINE_SECONDS,
    });
    // Longer than the SDK's 120s relay wait and five minute intent window,
    // either of which a single Bitcoin block (ten minutes on average) beats.
    expect(slow!.relayWaitMs).toBeGreaterThan(120_000);
    expect(slow!.intentDeadlineSeconds).toBeGreaterThan(300);
    expect(slow!.intentDeadlineSeconds * 1000).toBeGreaterThan(slow!.relayWaitMs);
  });

  it("lets the drawer close while the payment confirms", () => {
    expect(isPourLocked("confirming")).toBe(false);
    expect(isPourLocked("confirming", true)).toBe(false);
    expect(isPipelineStep("confirming")).toBe(false);
    expect(fillPhase("confirming", undefined)).toBe("confirming");
  });

  it("does not resolve or time out as a solver fill while it confirms", () => {
    expect(resolveTracking("confirming", SOLVED)).toBeNull();
    expect(resolveTracking("confirming", FAILED)).toBeNull();
    expect(releaseTracking("confirming")).toBe("confirming");
    expect(dueOneShot("confirming", null)).toBeNull();
  });

  it("keeps a drawer that was free to close free through tracking", () => {
    // An hour closable, then ninety locked seconds at the end, is a trap.
    expect(isPourLocked("tracking", true)).toBe(false);
    // But never through the wallet prompt, closable or not.
    expect(isPourLocked("signing", true)).toBe(true);
  });

  it("files a solver that was never told as its own per-order issue", () => {
    const untold = solverNotNotifiedReport(btcContext, {
      intentId: "7",
      spokeTxHash: txid,
      hubTxHash: "0x" + "c".repeat(64),
      notifyError: "Error: 503",
    });
    expect(untold.step).toBe("settling");
    expect(untold.errorCode).toBe("SOLVER_NOT_NOTIFIED");
    expect(untold.txHashes).toEqual([txid, "0x" + "c".repeat(64)]);
    expect(untold.diagnostics?.notifyError).toBe("Error: 503");
    expect(untold.rawMessage).not.toContain("503");
  });

  it("shows a payment that never reached Sonic apart from an order the solver holds", () => {
    expect(fillPhase("unsettled", undefined, false)).toBe("notArrived");
    expect(fillPhase("unsettled", undefined, true)).toBe("unsettled");
  });

  it("reports a relay stall with the payment's hash and link, as its own issue", () => {
    const stalled = unsettledReport(btcContext, {
      intentId: "7",
      spokeTxHash: txid,
      spokeTxUrl: `https://mempool.space/tx/${txid}`,
      trackedMs: BITCOIN_RELAY_WAIT_MS,
      relayError: "RELAY_TIMEOUT",
    });
    expect(stalled.step).toBe("settling");
    expect(stalled.errorCode).toBe("RELAY_UNSETTLED");
    expect(stalled.txHashes).toEqual([txid]);
    expect(stalled.diagnostics).toEqual({
      intentId: "7",
      spokeTxHash: txid,
      spokeTx: `https://mempool.space/tx/${txid}`,
      relay: "RELAY_TIMEOUT",
      relayWaitedFor: "5400s",
    });
    expect(stalled.rawMessage).toContain("RELAY_TIMEOUT");
    expect(stalled.rawMessage).not.toContain(txid);

    // Two payments slow the same way share an issue; a solver stall does not.
    const another = unsettledReport(btcContext, {
      intentId: "8",
      spokeTxHash: "e".repeat(64),
      trackedMs: BITCOIN_RELAY_WAIT_MS,
      relayError: "RELAY_TIMEOUT",
    });
    expect(fingerprintOf(another)).toBe(fingerprintOf(stalled));
    expect(fingerprintOf(unsettledReport(btcContext, facts()))).not.toBe(
      fingerprintOf(stalled),
    );
  });
});

describe("a payment from an EVM chain", () => {
  const EVM_SOURCES = [
    ChainKeys.BASE_MAINNET,
    ChainKeys.ETHEREUM_MAINNET,
    ChainKeys.ARBITRUM_MAINNET,
    ChainKeys.SONIC_MAINNET,
  ];

  it("keeps the SDK's relay path, and the tracking lock it had", () => {
    for (const chain of EVM_SOURCES) {
      // Not slow: the machine sends these through vaultSwap as before, and
      // a relay timeout there is still the failure it always was.
      expect(slowSource(chain)).toBeNull();
    }
    expect(isPourLocked("tracking")).toBe(true);
  });

  it("keeps the unsettled report it always filed", () => {
    const report = unsettledReport(context, facts());
    expect(report.errorCode).toBe("SOLVER_FILL_UNSETTLED");
    expect(report.diagnostics).not.toHaveProperty("relay");
    expect(report.diagnostics).not.toHaveProperty("spokeTx");
  });
});
