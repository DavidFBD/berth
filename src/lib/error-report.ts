import { recentLogs, type CapturedLog } from "@/lib/error-log-buffer";

/**
 * Client half of automatic error reporting: assemble what the team needs to
 * diagnose a failed pour, then hand it to `/api/report-error`, which files it
 * as a GitHub issue.
 *
 * Privacy: the repo is private, but reports still carry only what debugging
 * actually needs. No email address is ever collected, and the wallet address
 * is truncated to a correlation hint. Transaction hashes go in whole — they're
 * public on-chain data and the single most useful thing for tracing a pour.
 */

export type ErrorReportContext = {
  action: "deposit" | "withdraw";
  /** Pipeline stage that failed: building | approving | signing. */
  step: string;
  /** Vault share-token symbol, e.g. lsodaWEETH. */
  vaultName?: string;
  srcChainKey?: string;
  dstChainKey?: string;
  tokenSymbol?: string;
  /** Human-readable input amount. */
  amount?: string;
  /** email (Privy embedded) or external. */
  walletMode?: string;
  /** Truncated address, for correlating repeat reports. */
  addressHint?: string;
  /** SDK error code when the failure carried one. */
  errorCode?: string;
  /** The tea copy the user actually saw. */
  friendlyMessage: string;
  /** Raw error message from the SDK. */
  rawMessage?: string;
  /** Any tx hashes involved (spoke / hub / intent). */
  txHashes?: string[];
};

export type ErrorReportPayload = ErrorReportContext & {
  fingerprint: string;
  logs: CapturedLog[];
  page: {
    url: string;
    userAgent: string;
    viewport: string;
    at: string;
  };
};

export type ErrorReportResult = {
  status: "filed" | "duplicate" | "skipped" | "failed";
  issueNumber?: number;
  reason?: string;
};

/** Truncate an address to something correlatable but not directly identifying. */
export function addressHint(address: string | undefined): string | undefined {
  if (!address) return undefined;
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Stable 32-bit hash (FNV-1a) rendered as hex. Only needs to be stable and
 * collision-resistant enough to group identical failures, so no crypto — and
 * `crypto.subtle` would force this whole path async for nothing.
 */
function hash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * Group failures by cause, not by occurrence. Volatile parts of the message
 * (addresses, hashes, numbers) are stripped so the same bug from two users
 * lands on one issue instead of two.
 */
export function fingerprintOf(context: ErrorReportContext): string {
  const normalized = (context.rawMessage ?? context.friendlyMessage)
    .toLowerCase()
    .replace(/0x[a-f0-9]{6,}/g, "0x…")
    .replace(/\b\d[\d.,]*\b/g, "n")
    .slice(0, 300);
  return hash(
    [
      context.action,
      context.step,
      context.errorCode ?? "no-code",
      context.srcChainKey ?? "no-chain",
      normalized,
    ].join("|"),
  );
}

/**
 * Fingerprints already sent this session. A failing pour is often retried, and
 * the SDK itself retries underneath, so without this one bad afternoon becomes
 * a hundred comments on one issue.
 */
const sentThisSession = new Set<string>();

/** True when this failure is worth a team's attention. */
export function isReportable(friendlyMessage: string, cancelledCopy: string) {
  return friendlyMessage !== cancelledCopy;
}

export async function submitErrorReport(
  context: ErrorReportContext,
): Promise<ErrorReportResult> {
  const fingerprint = fingerprintOf(context);
  if (sentThisSession.has(fingerprint)) {
    return { status: "duplicate", reason: "already reported this session" };
  }
  sentThisSession.add(fingerprint);

  const payload: ErrorReportPayload = {
    ...context,
    fingerprint,
    logs: recentLogs(),
    page: {
      url: typeof window !== "undefined" ? window.location.href : "",
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
      viewport:
        typeof window !== "undefined"
          ? `${window.innerWidth}x${window.innerHeight}`
          : "",
      at: new Date().toISOString(),
    },
  };

  try {
    const response = await fetch("/api/report-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      // Let a retry through: this attempt never reached the tracker.
      sentThisSession.delete(fingerprint);
      return { status: "failed", reason: `route responded ${response.status}` };
    }
    return (await response.json()) as ErrorReportResult;
  } catch (error) {
    sentThisSession.delete(fingerprint);
    return {
      status: "failed",
      reason: error instanceof Error ? error.message : "network error",
    };
  }
}
