import { isUserRejectedError } from "@sodax/dapp-kit";

/**
 * Turning SDK failures into tea. Lives in `lib` rather than beside the vault
 * hook so the reporting layer can share it without importing React state.
 */

/** Cancel copy is compared by identity to style it gently and skip reporting. */
export const CANCELLED_MESSAGE = "No worries, the tea's still warm.";

/** A pour that was signed and submitted, then failed at the solver. */
export const FILL_FAILED_MESSAGE = "The kettle's acting up.";

/**
 * A pour that never left because the Privy session had gone stale. Privy
 * throws EIP-1193 code 4900 ("Disconnected") out of eth_sendTransaction when
 * its access token is missing, and viem renders 4900 as "The Provider is
 * disconnected from all chains" — which sent issue #21's triage chasing a
 * wrong-chain bug that was never there. The condition is the token, not the
 * chain.
 */
export const SESSION_EXPIRED_MESSAGE =
  "Your session went cold. Sign in again, then pour.";

/**
 * True for the 4900 "Disconnected" shape however deeply the SDK has wrapped
 * it. The code is matched numerically on purpose, since extractErrorCode
 * only reports string codes and a 4900 is invisible to it; the message is
 * matched as well because viem rewrites the code into prose on the way out.
 */
export function isSessionExpiredError(error: unknown): boolean {
  let node: unknown = error;
  for (let depth = 0; node !== null && node !== undefined && depth < 8; depth++) {
    if (typeof node !== "object") return false;
    const shape = node as { code?: unknown; message?: unknown; cause?: unknown };
    if (shape.code === 4900) return true;
    if (
      typeof shape.message === "string" &&
      shape.message.includes("disconnected from all chains")
    ) {
      return true;
    }
    node = shape.cause;
  }
  return false;
}

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
  // Ahead of the code switch: the SDK wraps this as INTENT_CREATION_FAILED,
  // so the generic fallback would otherwise blame the kettle for a lapsed
  // session and send the user round the same loop.
  if (isSessionExpiredError(error)) return SESSION_EXPIRED_MESSAGE;
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
