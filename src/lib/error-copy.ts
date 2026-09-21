import { isUserRejectedError } from "@sodax/dapp-kit";
import { formatUnits } from "viem";
import { COPY } from "@/lib/copy";

/**
 * Turning SDK failures into plain sentences. Lives in `lib` rather than
 * beside the vault hook so the reporting layer can share it without
 * importing React state.
 */

/** Cancel copy is compared by identity to style it gently and skip reporting. */
export const CANCELLED_MESSAGE = "Cancelled. Nothing was sent.";

/** An order that was signed and submitted, then failed at the solver. */
export const FILL_FAILED_MESSAGE = "The order could not be filled.";

/**
 * An order that never left because the Privy session had gone stale. Privy
 * throws EIP-1193 code 4900 ("Disconnected") out of eth_sendTransaction when
 * its access token is missing, and viem renders 4900 as "The Provider is
 * disconnected from all chains" — which sent issue #21's triage chasing a
 * wrong-chain bug that was never there. The condition is the token, not the
 * chain.
 */
export const SESSION_EXPIRED_MESSAGE =
  "Your session expired. Sign in again and retry.";

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

/**
 * A wallet that cannot pay for its own transaction. The SDK wraps this as
 * INTENT_CREATION_FAILED too, so without this the user is told "the order did
 * not go through, try again" about the one failure retrying cannot fix.
 *
 * Two shapes reach us: viem's prose, and the node's own line underneath it,
 * which carries the exact numbers ("have 743300593668700 want
 * 975917986270590", issue #23). The numbers are worth digging for, since
 * "add about 0.00024 ETH" is a user's next action and "not enough" is not.
 */
const INSUFFICIENT_FUNDS_PATTERNS = [
  "exceeds the balance of the account",
  "insufficient funds",
];

const HAVE_WANT = /\bhave (\d+)\s+want (\d+)\b/;

export type InsufficientGas = {
  /** Native units still needed, when the node told us. */
  shortfall?: bigint;
};

/** Every message-ish string down the cause chain, flattened for matching. */
function errorProse(error: unknown): string {
  const parts: string[] = [];
  let node: unknown = error;
  for (let depth = 0; node !== null && node !== undefined && depth < 8; depth++) {
    if (typeof node === "string") {
      parts.push(node);
      break;
    }
    if (typeof node !== "object") break;
    const shape = node as {
      message?: unknown;
      details?: unknown;
      shortMessage?: unknown;
      cause?: unknown;
    };
    for (const field of [shape.message, shape.details, shape.shortMessage]) {
      if (typeof field === "string") parts.push(field);
    }
    node = shape.cause;
  }
  return parts.join("\n");
}

/** Undefined when the failure is something else entirely. */
export function insufficientGasError(error: unknown): InsufficientGas | undefined {
  const prose = errorProse(error).toLowerCase();
  if (!prose) return undefined;
  if (!INSUFFICIENT_FUNDS_PATTERNS.some((p) => prose.includes(p))) {
    return undefined;
  }
  const found = HAVE_WANT.exec(prose);
  if (!found) return {};
  const have = BigInt(found[1]);
  const want = BigInt(found[2]);
  return { shortfall: want > have ? want - have : undefined };
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
/**
 * Round a shortfall up to two significant figures, with half again on top so
 * the number still works after gas has moved a little. Reads as an amount a
 * person would actually top up: "0.00035 ETH", not "0.000232617392601890".
 */
export function gasShortfallText(
  shortfall: bigint,
  decimals: number,
  symbol: string,
): string | undefined {
  const exact = Number(formatUnits(shortfall, decimals));
  if (!Number.isFinite(exact) || exact <= 0) return undefined;
  const padded = exact * 1.5;
  const magnitude = Math.floor(Math.log10(padded));
  const step = 10 ** (magnitude - 1);
  const rounded = Math.ceil(padded / step) * step;
  const places = Math.max(0, 1 - magnitude);
  const text = rounded
    .toFixed(places)
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
  return `${text} ${symbol}`;
}

/**
 * The native token of the chain the transaction is paid from, so a fee
 * failure can name what to top up and where.
 */
export type GasContext = {
  symbol: string;
  decimals: number;
  /** Display name of the source chain, e.g. "Base". */
  network: string;
};

export function friendlyError(
  error: unknown,
  fallback: string,
  gas?: GasContext,
): string {
  if (isUserRejectedError(error)) return CANCELLED_MESSAGE;
  // Ahead of the code switch: the SDK wraps this as INTENT_CREATION_FAILED,
  // so the generic fallback would otherwise blame the network for a lapsed
  // session and send the user round the same loop.
  if (isSessionExpiredError(error)) return SESSION_EXPIRED_MESSAGE;
  // Also ahead of it, and for the same reason: an unpayable fee arrives
  // wrapped as INTENT_CREATION_FAILED, and "try again" is advice that cannot
  // work until the wallet holds more of the native token (issues #22, #23).
  const unpayable = insufficientGasError(error);
  if (unpayable && gas) {
    const needed =
      unpayable.shortfall === undefined
        ? undefined
        : gasShortfallText(unpayable.shortfall, gas.decimals, gas.symbol);
    return needed
      ? COPY.errNeedsGas(needed, gas.network)
      : COPY.errNeedsGasUnknown(gas.network);
  }
  switch (extractErrorCode(error)) {
    case "USER_REJECTED":
      return CANCELLED_MESSAGE;
    case "RELAY_TIMEOUT":
    case "RELAY_FAILED":
    case "TX_SUBMIT_FAILED":
    case "TX_VERIFICATION_FAILED":
      return "Your transaction was sent and cross network delivery is taking longer than usual. Your funds are safe; this usually resolves itself.";
    case "EXECUTION_FAILED":
    case "EXTERNAL_API_ERROR":
      return "Your order is registered but the network has not confirmed the fill yet. It is safe to try again.";
    default:
      return fallback;
  }
}
