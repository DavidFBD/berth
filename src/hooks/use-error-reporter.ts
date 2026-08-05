"use client";

import { useCallback, useState } from "react";
import {
  isReportable,
  submitErrorReport,
  type ErrorReportContext,
  type ReportState,
} from "@/lib/error-report";
import { CANCELLED_MESSAGE } from "@/lib/error-copy";

/**
 * Shared plumbing for handing a user-facing failure to the team.
 *
 * Every surface that shows a user an error should route through this, not just
 * the deposit/withdraw pipeline: a pour that fails at the solver AFTER being
 * signed is just as much a failed transaction as one that never got sent, and
 * arguably more urgent, since the user's funds have already moved.
 *
 * Reporting is fire-and-forget by design. It updates `reportState` so the UI
 * can say the team has it, and otherwise never interferes with the failure
 * being reported.
 */
export function useErrorReporter() {
  const [reportState, setReportState] = useState<ReportState>("idle");

  const report = useCallback((context: ErrorReportContext) => {
    // A cancelled action isn't a bug — the user chose it.
    if (!isReportable(context.friendlyMessage, CANCELLED_MESSAGE)) {
      setReportState("unsent");
      return;
    }
    setReportState("sending");
    void submitErrorReport(context).then((result) => {
      setReportState(
        result.status === "filed" || result.status === "duplicate"
          ? "filed"
          : "unsent",
      );
    });
  }, []);

  const resetReport = useCallback(() => setReportState("idle"), []);

  return { reportState, report, resetReport };
}
