import { useSyncExternalStore } from "react";
import type { UnavailableReason } from "@/lib/availability";

/**
 * The server's own word that Berth is not available here (HTTP 451, code
 * unavailable_here, lib/server/availability), remembered for this page
 * load only, so the app can show the landing instead of a failed request.
 * The profile route answering 451 means a sign in that would have made a
 * new account: none was made. Nothing is written to storage.
 */

let refused: ReadonlyMap<string, UnavailableReason> = new Map();
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

/** Remember a refusal of `path`, with the kind of reason the route gave (the United States when it gave none). */
export function noteUnavailable(path: string, reason: UnavailableReason = "united-states"): void {
  if (refused.get(path) === reason) return;
  refused = new Map(refused).set(path, reason);
  emit();
}

/** The reason in a 451's body, read without consuming the response. */
export async function unavailableReasonOf(response: Response): Promise<UnavailableReason> {
  const body = (await response.clone().json().catch(() => ({}))) as { reason?: unknown };
  return body.reason === "sanctions" ? "sanctions" : "united-states";
}

/** Whether a response is the availability refusal. */
export function isUnavailableResponse(response: { status: number }): boolean {
  return response.status === 451;
}

export function forgetUnavailable(): void {
  refused = new Map();
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Why the server refused this path during this page load, or null. */
export function useUnavailableReason(path: string): UnavailableReason | null {
  return useSyncExternalStore(
    subscribe,
    () => refused.get(path) ?? null,
    () => null,
  );
}

/** Whether any route refused this page load for a comprehensively sanctioned place. */
export function useRefusedForSanctions(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => [...refused.values()].includes("sanctions"),
    () => false,
  );
}

/** Whether the server refused this path for availability during this page load. */
export function useUnavailableRefused(path: string): boolean {
  return useUnavailableReason(path) !== null;
}
