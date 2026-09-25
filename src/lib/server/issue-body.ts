import type { ErrorReportPayload } from "@/lib/error-report";

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

/** Issue title: what failed, where, and the tersest available cause. */
export function issueTitle(payload: ErrorReportPayload): string {
  return `${payload.action} failed at ${payload.step}${
    payload.srcChainKey ? ` on ${payload.srcChainKey}` : ""
  }: ${payload.errorCode ?? payload.friendlyMessage}`.slice(0, 200);
}

export function buildIssueBody(
  payload: ErrorReportPayload,
  sha: string | undefined,
): string {
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
