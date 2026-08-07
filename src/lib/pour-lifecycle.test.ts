import { describe, expect, it } from "vitest";
import { SolverIntentStatusCode } from "@sodax/sdk";
import {
  fillPhase,
  isPipelineStep,
  isPourLocked,
  resolveTracking,
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
});

describe("isPourLocked", () => {
  it("locks through the whole pipeline", () => {
    expect(isPourLocked("building", false)).toBe(true);
    expect(isPourLocked("approving", false)).toBe(true);
    expect(isPourLocked("signing", false)).toBe(true);
  });

  it("locks while tracking, until the bounded wait releases it", () => {
    expect(isPourLocked("tracking", false)).toBe(true);
    expect(isPourLocked("tracking", true)).toBe(false);
  });

  it("never locks a settled pour", () => {
    for (const step of ["idle", "filled", "fillFailed", "error"] as PourStep[]) {
      expect(isPourLocked(step, false)).toBe(false);
    }
  });
});

describe("isPipelineStep", () => {
  it("covers exactly the pre-signature steps", () => {
    const pipeline: PourStep[] = ["building", "approving", "signing"];
    const rest: PourStep[] = ["idle", "tracking", "filled", "fillFailed", "error"];
    for (const step of pipeline) expect(isPipelineStep(step)).toBe(true);
    for (const step of rest) expect(isPipelineStep(step)).toBe(false);
  });
});
