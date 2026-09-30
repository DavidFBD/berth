import type { RecurringResponse } from "@/lib/recurring";
import { isUnavailableResponse, noteUnavailable, unavailableReasonOf } from "@/lib/unavailable-refusal";

/** A plan action the route refused, with its reason. */
export class RecurringError extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

/** The reason a refused plan action carries: Berth not available here (HTTP 451) is its own. */
export const RECURRING_UNAVAILABLE = "unavailable_here";

export const RECURRING_PATH = "/api/recurring";

/**
 * The route's answer, or the reason it refused. A 451 (lib/server/availability)
 * is remembered for the page (lib/unavailable-refusal), so the plan sheet
 * shows the landing, and reads as RECURRING_UNAVAILABLE.
 */
export async function readRecurringResponse(response: Response): Promise<RecurringResponse> {
  if (isUnavailableResponse(response)) {
    noteUnavailable(RECURRING_PATH, await unavailableReasonOf(response));
    throw new RecurringError(RECURRING_UNAVAILABLE);
  }
  if (!response.ok) {
    const reason = ((await response.json().catch(() => ({}))) as { error?: string }).error ?? "failed";
    throw new RecurringError(reason);
  }
  return response.json() as Promise<RecurringResponse>;
}

