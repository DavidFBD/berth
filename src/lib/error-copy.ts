import { isUserRejectedError } from "@sodax/dapp-kit";

/**
 * Turning SDK failures into tea. Lives in `lib` rather than beside the vault
 * hook so the reporting layer can share it without importing React state.
 */

/** Cancel copy is compared by identity to style it gently and skip reporting. */
export const CANCELLED_MESSAGE = "No worries, the tea's still warm.";

/** A pour that was signed and submitted, then failed at the solver. */
export const FILL_FAILED_MESSAGE = "The kettle's acting up.";

export function extractErrorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

/** Best-effort human-readable message off an unknown SDK error, for reports. */
export function rawErrorMessage(error: unknown): string | undefined {
  if (error === undefined || error === null) return undefined;
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === "string") return error;
  if (typeof error === "object") {
    const shape = error as { message?: unknown; error?: unknown };
    if (typeof shape.message === "string") return shape.message;
    if (typeof shape.error === "string") return shape.error;
    try {
      return JSON.stringify(error, (_k, v) =>
        typeof v === "bigint" ? `${v}n` : v,
      )?.slice(0, 2_000);
    } catch {
      return undefined;
    }
  }
  return String(error);
}

/** Map SDK error codes to human copy per the shared error-handling contract. */
export function friendlyError(error: unknown, fallback: string): string {
  if (isUserRejectedError(error)) return CANCELLED_MESSAGE;
  switch (extractErrorCode(error)) {
    case "USER_REJECTED":
      return CANCELLED_MESSAGE;
    case "RELAY_TIMEOUT":
    case "RELAY_FAILED":
    case "TX_SUBMIT_FAILED":
    case "TX_VERIFICATION_FAILED":
      return "Your pour was sent but the tray is taking a while. Funds are safe, this usually resolves itself.";
    case "EXECUTION_FAILED":
    case "EXTERNAL_API_ERROR":
      return "Your pour is on the counter but the solver hasn't confirmed. It's safe to retry.";
    default:
      return fallback;
  }
}
