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
 * RPC keys are not: node errors often quote the URL they called, key and
 * all, so raw text is passed through `redactSecrets` before it leaves.
 */

/** Whether a failure has reached the tracker, for the error UI to say so. */
export type ReportState = "idle" | "sending" | "filed" | "unsent";

export type ErrorReportContext = {
  action: "deposit" | "withdraw";
  /**
   * Where it failed. The build/approve/sign pipeline steps, `filling` for a
   * pour that was signed and submitted and then failed at the solver, or
   * `settling` for one the solver never reported as done inside the wait.
   */
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
  /**
   * Per-occurrence facts for triage (hashes, timings, last status). Rendered
   * in the issue, never fingerprinted, so two intents stuck the same way land
   * on one issue with each one's details in its own comment.
   */
  diagnostics?: Record<string, string>;
  /**
   * A note on an issue that already exists, never a new one: how an
   * unsettled order ended ("Settled after 143s"). Sent with the context of
   * the report it follows, so it carries the same fingerprint and the server
   * posts it as a comment on that issue.
   */
  followUp?: string;
};

/**
 * The pour half of a report: what was being attempted, independent of how it
 * failed. Assembled once per run by `useVaultAction` and completed into a
 * full context at failure time — so every report, pipeline or solver-fill,
 * carries the same description without any caller re-deciding which fields
 * matter.
 */
export type PourReportContext = Omit<
  ErrorReportContext,
  "friendlyMessage" | "errorCode" | "rawMessage"
>;

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
 * Keys that ride inside RPC URLs, in the shapes node errors quote them:
 * Alchemy `/v2/<key>`, Infura `/v3/<project id>`, QuickNode's path token,
 * Ankr's `/<chain>/<key>`, query parameters like `?apikey=` or Helius's
 * `?api-key=`, dRPC's `?dkey=`, a bare hex key as the first path segment
 * (Chainstack, GetBlock), and bearer tokens. The bare hex rule refuses a
 * 0x prefix, so an EVM hash or address in a URL is never mistaken for a key.
 */
const SECRET_PATTERNS: [RegExp, string][] = [
  [/(\/v[23]\/)[A-Za-z0-9_-]{16,}/g, "$1[redacted]"],
  [/(\.quiknode\.pro\/)[A-Za-z0-9_-]+/gi, "$1[redacted]"],
  [/(rpc\.ankr\.com\/[a-z0-9_]+\/)[A-Za-z0-9]{16,}/gi, "$1[redacted]"],
  [
    /(https?:\/\/[^/\s"'?#]+\/)(?!0x)[0-9a-f]{32,}(?=[/?#\s"')]|$)/gi,
    "$1[redacted]",
  ],
  [
    /([?&](?:api[-_]?key|dkey|key|token|access[-_]?token|auth|secret)=)[^&\s"'#)]+/gi,
    "$1[redacted]",
  ],
  [/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/g, "$1[redacted]"],
];

/** Strip RPC keys and tokens out of text bound for the tracker. */
export function redactSecrets(text: string): string {
  return SECRET_PATTERNS.reduce(
    (out, [pattern, replacement]) => out.replace(pattern, replacement),
    text,
  );
}

/** The context with every free-text field redacted. */
function redactContext(context: ErrorReportContext): ErrorReportContext {
  return {
    ...context,
    rawMessage:
      context.rawMessage === undefined
        ? undefined
        : redactSecrets(context.rawMessage),
    followUp:
      context.followUp === undefined
        ? undefined
        : redactSecrets(context.followUp),
    diagnostics: context.diagnostics
      ? Object.fromEntries(
          Object.entries(context.diagnostics).map(([key, value]) => [
            key,
            redactSecrets(value),
          ]),
        )
      : undefined,
  };
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
    // Request ids first: a UUID survives both rules below (its groups start
    // with a letter as often as not, and `\b\d[\d.,]*\b` needs a word
    // boundary a hex group does not give), so one Solana RPC outage filed
    // five identical issues, #16 through #20, differing only by the id the
    // node echoed back.
    .replace(/\b[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/g, "uuid")
    .replace(/0x[a-f0-9]{6,}/g, "0x…")
    // Base58 account addresses, which carry no 0x and are not all digits.
    // The alphabet is matched as lowercased above, so its exclusions (0, O,
    // I, l) collapse to "no zero": what is left is a long unbroken run of
    // letters and digits, which in a node's message is always an identifier.
    .replace(/\b[1-9a-z]{32,44}\b/g, "acct")
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
 * Fingerprints already sent this session, each holding the attempt itself. A
 * failing pour is often retried, and the SDK itself retries underneath, so
 * without this one bad afternoon becomes a hundred comments on one issue.
 *
 * The attempt is kept rather than the bare fingerprint so a repeat can answer
 * with what actually happened to the first one. It used to answer "duplicate"
 * unconditionally, which the UI reads as filed, so a second failure could tell
 * the user the team had been told when nothing had been sent at all.
 */
const reportedThisSession = new Map<string, Promise<ErrorReportResult>>();

/** True when this failure is worth a team's attention. */
export function isReportable(friendlyMessage: string, cancelledCopy: string) {
  return friendlyMessage !== cancelledCopy;
}

export async function submitErrorReport(
  unredacted: ErrorReportContext,
): Promise<ErrorReportResult> {
  const context = redactContext(unredacted);
  const fingerprint = fingerprintOf(context);
  // A stuck order is reported per order, and so is how it ended: each one's
  // hashes and timings are the point, and the server already folds repeats
  // into one issue as comments. Every other step keeps the session dedup.
  if (context.step === "settling") return sendReport(context, fingerprint);
  const earlier = reportedThisSession.get(fingerprint);
  if (earlier) {
    // Whatever became of the first attempt is the truth about this one, down
    // to the issue number, so a retry can still show the same reference.
    const result = await earlier;
    return { ...result, reason: "already reported this session" };
  }

  const attempt = sendReport(context, fingerprint);
  reportedThisSession.set(fingerprint, attempt);
  const result = await attempt;
  // Let a retry through: this attempt never reached the tracker.
  if (result.status === "failed") reportedThisSession.delete(fingerprint);
  return result;
}

async function sendReport(
  context: ErrorReportContext,
  fingerprint: string,
): Promise<ErrorReportResult> {
  const payload: ErrorReportPayload = {
    ...context,
    fingerprint,
    logs: recentLogs().map((log) => ({ ...log, text: redactSecrets(log.text) })),
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
      return { status: "failed", reason: `route responded ${response.status}` };
    }
    return (await response.json()) as ErrorReportResult;
  } catch (error) {
    return {
      status: "failed",
      reason: error instanceof Error ? error.message : "network error",
    };
  }
}
