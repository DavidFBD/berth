// The quote path: the files and packages that decide what a quote asks the
// solver. pnpm verify refuses --solver-down-ack when a branch touches any of
// them, since a Berth change here can make the solver answer -4 "No path"
// exactly as a solver outage does (reports/quote-guards-review-guards.md M3).

export const QUOTE_PATH = [
  /^src\/lib\/listings\.ts$/,
  /^src\/lib\/sodax-config\.ts$/,
  /^src\/hooks\/use-pour-quote\.ts$/,
  /^src\/lib\/quote-hold\.ts$/,
  /^src\/lib\/quote-smoke\.ts$/,
  /^src\/lib\/server\/sodax-proxy\.ts$/,
  /^src\/app\/api\/sodax\//,
];

/**
 * Whether a lockfile diff adds or removes a line naming @sodax/* or @privy-io/*.
 * @param {string} lockDiff
 */
export function lockTouchesSdk(lockDiff) {
  return lockDiff
    .split("\n")
    .some((line) => /^[+-]/.test(line) && !/^(\+\+\+|---)/.test(line) && /@sodax\/|@privy-io\//.test(line));
}

/**
 * What on the quote path a branch changed, as words for the refusal; empty when nothing.
 * @param {{ changed: Iterable<string>, sdkPackages?: string[], lockDiff?: string }} input
 * @returns {string[]}
 */
export function quotePathTouched({ changed, sdkPackages = [], lockDiff = "" }) {
  return [
    ...[...changed].filter((path) => QUOTE_PATH.some((pattern) => pattern.test(path))),
    ...sdkPackages.map((name) => `package.json ${name}`),
    ...(lockTouchesSdk(lockDiff) ? ["pnpm-lock.yaml (@sodax/* or @privy-io/*)"] : []),
  ];
}
