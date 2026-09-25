import { redactSecrets, type ErrorReportPayload } from "@/lib/error-report";

/**
 * The one thing the whole error-reporting pipeline exists to produce: the
 * GitHub issue's markdown. Pure, so the fence escaping (security-relevant:
 * log text is attacker-influenced browser input) and the field table are
 * testable without a GitHub token. The route owns transport, dedup, and
 * rate limiting; this module owns the words.
 */

/** Only the tail of the console matters; the cap keeps issues readable. */
export const MAX_LOGS = 40;

/**
 * The dedup handle: repeat occurrences of one cause find their issue by
 * scanning open issue bodies for this exact string.
 */
export function fingerprintMarker(fingerprint: string): string {
  return `fingerprint:${fingerprint}`;
}

/** Fenced so log text can never break out of the issue body's markdown. */
export function codeBlock(text: string, lang = ""): string {
  return `\`\`\`${lang}\n${text.replace(/```/g, "``​`")}\n\`\`\``;
}

/**
 * Issue title: what failed, where, and the tersest available cause. An order
 * that never settled has not failed (its funds may still arrive), so its
 * title says unsettled rather than "failed at settling".
 */
export function issueTitle(payload: ErrorReportPayload): string {
  const what =
    payload.step === "settling"
      ? `${payload.action} unsettled`
      : `${payload.action} failed at ${payload.step}`;
  return redactSecrets(
    `${what}${payload.srcChainKey ? ` on ${payload.srcChainKey}` : ""}: ${
      payload.errorCode ?? payload.friendlyMessage
    }`,
  ).slice(0, 200);
}

export function buildIssueBody(
  unredacted: ErrorReportPayload,
  sha: string | undefined,
): string {
  // The client already redacts, but a stale tab runs whatever it loaded, so
  // the server strips keys again with the same rules before anything is filed.
  const payload = redactPayload(unredacted);
  const rows: [string, string | undefined][] = [
    ["Action", payload.action],
    ["Failed at step", payload.step],
    ["Vault", payload.vaultName],
    ["Source chain", payload.srcChainKey],
    ["Destination chain", payload.dstChainKey],
    ["Token", payload.tokenSymbol],
    ["Amount", payload.amount],
    ["Wallet mode", payload.walletMode],
    ["Address", payload.addressHint],
    ["SDK error code", payload.errorCode],
    ["Deploy", sha],
  ];

  // Fenced rather than tabled: the values are browser input, and a fence is
  // the one shape they cannot break out of.
  const diagnostics = Object.entries(payload.diagnostics ?? {})
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");

  const logs = payload.logs
    .slice(-MAX_LOGS)
    .map((log) => `${log.at} [${log.level}] ${log.text}`)
    .join("\n");

  return [
    `**What the user saw:** ${payload.friendlyMessage}`,
    "",
    "| | |",
    "|---|---|",
    ...rows
      .filter(([, value]) => value)
      .map(([label, value]) => `| ${label} | \`${value}\` |`),
    "",
    payload.rawMessage
      ? `### Raw error\n${codeBlock(payload.rawMessage)}`
      : "",
    diagnostics ? `### Diagnostics\n${codeBlock(diagnostics)}` : "",
    payload.txHashes?.length
      ? `### Transactions\n${payload.txHashes.map((h) => `- \`${h}\``).join("\n")}`
      : "",
    logs ? `### Console (most recent last)\n${codeBlock(logs)}` : "",
    "### Client",
    codeBlock(
      [
        `url:       ${payload.page.url}`,
        `at:        ${payload.page.at}`,
        `viewport:  ${payload.page.viewport}`,
        `userAgent: ${payload.page.userAgent}`,
      ].join("\n"),
    ),
    "",
    "---",
    `Filed automatically from the app. Grouped by \`${fingerprintMarker(payload.fingerprint)}\`, do not edit that marker, it is how repeat occurrences find this issue.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * The comment for a follow-up: how an order already on an issue ended. The
 * note is browser input, so it is redacted, capped and fenced like the rest.
 */
export function followUpComment(payload: ErrorReportPayload): string {
  const note = redactSecrets(String(payload.followUp ?? "")).slice(0, 500);
  return [`**Follow up at ${payload.page.at}**`, codeBlock(note)].join("\n");
}

/** Every free-text field of the payload, with RPC keys and tokens removed. */
function redactPayload(payload: ErrorReportPayload): ErrorReportPayload {
  return {
    ...payload,
    friendlyMessage: redactSecrets(payload.friendlyMessage),
    rawMessage:
      payload.rawMessage === undefined
        ? undefined
        : redactSecrets(payload.rawMessage),
    diagnostics: payload.diagnostics
      ? Object.fromEntries(
          Object.entries(payload.diagnostics).map(([key, value]) => [
            key,
            redactSecrets(String(value)),
          ]),
        )
      : undefined,
    logs: (payload.logs ?? []).map((log) => ({
      ...log,
      text: redactSecrets(String(log.text)),
    })),
    page: { ...payload.page, url: redactSecrets(payload.page.url) },
  };
}
